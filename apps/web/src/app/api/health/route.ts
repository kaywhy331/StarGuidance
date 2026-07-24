import { NextResponse } from "next/server";
import { createDatabaseClient } from "@starguidance/database";

import { isHostedNetlifyRuntime, isLocalRuntimeAdapterAuthorized } from "@/lib/hosted-runtime";

const REQUIRED_STAGING_ENVIRONMENT = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "DATABASE_URL",
  "DATA_ENCRYPTION_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PROFILE_ENGINE_URL",
  "PROFILE_ENGINE_SHARED_SECRET",
] as const;

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
  const baseUrl = process.env.PROFILE_ENGINE_URL?.replace(/\/$/, "");
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
          await tx.unsafe("set local role authenticated");
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
  const requiredEnvironment = REQUIRED_STAGING_ENVIRONMENT.map((name) => ({
    name,
    present: configured(name),
  }));
  const missingEnvironmentVariables = requiredEnvironment
    .filter(({ present }) => !present)
    .map(({ name }) => name);
  const invalidEnvironmentVariables: string[] = [];
  if (configured("DATA_ENCRYPTION_KEY")) {
    try {
      if (Buffer.from(process.env.DATA_ENCRYPTION_KEY as string, "base64").length !== 32)
        invalidEnvironmentVariables.push("DATA_ENCRYPTION_KEY");
    } catch {
      invalidEnvironmentVariables.push("DATA_ENCRYPTION_KEY");
    }
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
    database.connection &&
    database.schemaReady &&
    database.rlsReady &&
    database.actorTransactionReady;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      stagingPreview,
      appEnvironment: appEnvironment(),
      runtimeAdapter: runtimeAdapter(),
      localPersistenceEnabled: isLocalRuntimeAdapterAuthorized(),
      localAdapterExplicitlyAllowed: process.env.ALLOW_LOCAL_RUNTIME_ADAPTER === "true",
      requiredEnvironment,
      missingEnvironmentVariables,
      invalidEnvironmentVariables,
      profileEngine,
      database,
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
