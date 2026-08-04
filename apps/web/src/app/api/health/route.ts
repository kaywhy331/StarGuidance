import { NextResponse } from "next/server";
import { createInterpretationProvider } from "@starguidance/ai";
import {
  APPLICATION_DATABASE_ROLE,
  createDatabaseClient,
  isValidEncryptionKey,
} from "@starguidance/database";

import { isHostedNetlifyRuntime, isLocalRuntimeAdapterAuthorized } from "@/lib/hosted-runtime";
import { profileEngineBaseUrl } from "@/lib/profile-engine";
import { findServiceUrlProblem } from "@/lib/service-url";

const REQUIRED_STAGING_ENVIRONMENT = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "DATABASE_URL",
  "DATA_ENCRYPTION_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PROFILE_ENGINE_URL",
  "PROFILE_ENGINE_SHARED_SECRET",
  "AI_PROVIDER",
  "AI_PROVIDER_API_KEY",
  "AI_PROVIDER_MODEL",
] as const;

const APPROVED_STAGING_PROVIDER_ID = "groq:openai/gpt-oss-120b";

type DependencyStatus = {
  healthStatus: number | null;
  unauthorizedComputeStatus: number | null;
  authorizedComputeStatus: number | null;
};

type DatabaseStatus = {
  connection: boolean;
  schemaReady: boolean;
  rlsReady: boolean;
  actorTransactionReady: boolean;
};

function configured(name: string): boolean {
  return Boolean(process.env[name]?.trim());
}

function appEnvironment(): string {
  const value = process.env.APP_ENV;
  return value === "development" ||
    value === "test" ||
    value === "staging" ||
    value === "production"
    ? value
    : "misconfigured";
}

function runtimeAdapter(): string {
  const value = process.env.RUNTIME_ADAPTER;
  return value === "local" || value === "supabase" ? value : "misconfigured";
}

async function probeProfileEngine(): Promise<DependencyStatus> {
  // Built the same way the application builds it. Normalising here but not in
  // the client is precisely what let a trailing slash break every calculation
  // while this endpoint reported the dependency healthy.
  let baseUrl: string | undefined;
  try {
    baseUrl = process.env.PROFILE_ENGINE_URL ? profileEngineBaseUrl() : undefined;
  } catch {
    baseUrl = undefined;
  }
  const sharedSecret = process.env.PROFILE_ENGINE_SHARED_SECRET;
  if (!baseUrl)
    return {
      healthStatus: null,
      unauthorizedComputeStatus: null,
      authorizedComputeStatus: null,
    };

  const probe = async (path: string, init?: RequestInit): Promise<number | null> => {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });
      return response.status;
    } catch {
      return null;
    }
  };

  const syntheticRequest = JSON.stringify({
    full_birth_name: "Synthetic Verification",
    birth_date: "2000-01-01",
  });
  const [healthStatus, unauthorizedComputeStatus, authorizedComputeStatus] = await Promise.all([
    probe("/health"),
    probe("/v1/profile/compute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: syntheticRequest,
    }),
    sharedSecret
      ? probe("/v1/profile/compute", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${sharedSecret}`,
          },
          body: syntheticRequest,
        })
      : Promise.resolve(null),
  ]);
  return { healthStatus, unauthorizedComputeStatus, authorizedComputeStatus };
}

async function probeDatabase(): Promise<DatabaseStatus> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    return {
      connection: false,
      schemaReady: false,
      rlsReady: false,
      actorTransactionReady: false,
    };
  const client = createDatabaseClient(databaseUrl);
  try {
    const [readiness] = await client.unsafe<{ schema_ready: boolean; rls_ready: boolean }[]>(`
      select
        (
          to_regclass('public.users') is not null
          and to_regclass('public.consents') is not null
          and to_regclass('public.birth_profiles') is not null
          and to_regclass('public.profile_snapshots') is not null
          and to_regclass('public.profile_components') is not null
          and to_regclass('public.profile_traits') is not null
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'birth_profiles'
              and column_name = 'active_snapshot_id'
          )
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'reading_sessions'
              and column_name = 'reading_lens'
          )
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'orders'
              and column_name = 'profile_snapshot_id'
          )
          and not exists (
            select required.column_name
            from unnest(array[
              'processing_started_at', 'attempt_count', 'last_failure_code'
            ]) as required(column_name)
            where not exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'payment_webhook_events'
                and columns.column_name = required.column_name
            )
          )
          and exists (
            select 1 from pg_roles where rolname = '${APPLICATION_DATABASE_ROLE}'
              and not rolcanlogin and not rolsuper and not rolbypassrls
          )
          and not (
            has_table_privilege('authenticated', 'public.users', 'select')
            or has_table_privilege('authenticated', 'public.reading_draws', 'update')
            or has_table_privilege('authenticated', 'public.entitlements', 'insert')
          )
        ) as schema_ready,
        not exists (
          select 1
          from unnest(array[
            'users', 'consents', 'birth_profiles', 'profile_snapshots',
            'profile_components', 'profile_traits'
          ]) as required(table_name)
          where not exists (
            select 1
            from pg_class c
            join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = required.table_name
              and c.relrowsecurity and c.relforcerowsecurity
          )
        ) as rls_ready
    `);
    let actorTransactionReady = false;
    if (readiness?.schema_ready && readiness.rls_ready) {
      try {
        await client.begin(async (tx) => {
          await tx.unsafe(`set local role ${APPLICATION_DATABASE_ROLE}`);
          await tx`select set_config('request.jwt.claim.sub', ${"00000000-0000-4000-8000-000000000000"}, true)`;
          await tx`select id from users limit 1`;
        });
        actorTransactionReady = true;
      } catch {
        actorTransactionReady = false;
      }
    }
    return {
      connection: true,
      schemaReady: readiness?.schema_ready === true,
      rlsReady: readiness?.rls_ready === true,
      actorTransactionReady,
    };
  } catch {
    return {
      connection: false,
      schemaReady: false,
      rlsReady: false,
      actorTransactionReady: false,
    };
  } finally {
    await client.end({ timeout: 1 }).catch(() => undefined);
  }
}

export async function GET() {
  const stagingPreview = process.env.APP_ENV === "staging" && isHostedNetlifyRuntime();
  const interpretationProviderId = createInterpretationProvider().id;
  const interpretation = {
    providerKind: interpretationProviderId.startsWith("groq:") ? "groq" : "deterministic",
    approvedLiveProviderConfigured: interpretationProviderId === APPROVED_STAGING_PROVIDER_ID,
  };
  const requiredEnvironment = REQUIRED_STAGING_ENVIRONMENT.map((name) => ({
    name,
    present: configured(name),
  }));
  const missingEnvironmentVariables = requiredEnvironment
    .filter(({ present }) => !present)
    .map(({ name }) => name);
  const invalidEnvironmentVariables: string[] = [];
  if (configured("DATA_ENCRYPTION_KEY")) {
    if (!isValidEncryptionKey(process.env.DATA_ENCRYPTION_KEY as string))
      invalidEnvironmentVariables.push("DATA_ENCRYPTION_KEY");
  }
  if (configured("DATA_ENCRYPTION_KEYS_PREVIOUS")) {
    const previous = (process.env.DATA_ENCRYPTION_KEYS_PREVIOUS as string)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (previous.length > 3 || previous.some((key) => !isValidEncryptionKey(key)))
      invalidEnvironmentVariables.push("DATA_ENCRYPTION_KEYS_PREVIOUS");
  }
  // A dependency address that is not a base URL is a configuration fault, and
  // reporting it here is the difference between "the engine is down" and "the
  // variable is wrong".
  if (configured("PROFILE_ENGINE_URL")) {
    const problem = findServiceUrlProblem(
      "PROFILE_ENGINE_URL",
      (process.env.PROFILE_ENGINE_URL as string).trim().replace(/\/+$/, ""),
    );
    if (problem) invalidEnvironmentVariables.push("PROFILE_ENGINE_URL");
  }

  const profileEngine = stagingPreview
    ? await probeProfileEngine()
    : {
        healthStatus: null,
        unauthorizedComputeStatus: null,
        authorizedComputeStatus: null,
      };
  const database = stagingPreview
    ? await probeDatabase()
    : {
        connection: false,
        schemaReady: false,
        rlsReady: false,
        actorTransactionReady: false,
      };
  const healthy =
    stagingPreview &&
    runtimeAdapter() === "supabase" &&
    !isLocalRuntimeAdapterAuthorized() &&
    process.env.ALLOW_LOCAL_RUNTIME_ADAPTER !== "true" &&
    missingEnvironmentVariables.length === 0 &&
    invalidEnvironmentVariables.length === 0 &&
    profileEngine.healthStatus === 200 &&
    profileEngine.unauthorizedComputeStatus === 401 &&
    profileEngine.authorizedComputeStatus === 200 &&
    interpretation.approvedLiveProviderConfigured &&
    database.connection &&
    database.schemaReady &&
    database.rlsReady &&
    database.actorTransactionReady;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      stagingPreview,
      // Build provenance, so staging verification can prove the preview it is
      // testing was built from the commit under test. Withheld in production:
      // a public deployment need not advertise which commit it runs.
      deployedCommit: stagingPreview ? (process.env.DEPLOYED_COMMIT_REF ?? null) || null : null,
      appEnvironment: appEnvironment(),
      runtimeAdapter: runtimeAdapter(),
      localPersistenceEnabled: isLocalRuntimeAdapterAuthorized(),
      localAdapterExplicitlyAllowed: process.env.ALLOW_LOCAL_RUNTIME_ADAPTER === "true",
      requiredEnvironment,
      missingEnvironmentVariables,
      invalidEnvironmentVariables,
      // Report only a provider class and an approved-contract boolean. The
      // credential and arbitrary environment values never enter this payload.
      interpretation,
      profileEngine,
      database,
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
