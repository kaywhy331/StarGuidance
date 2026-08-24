import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  configuredAiProviderRoute,
  configuredGroqModelChain,
  createInterpretationProvider,
} from "@starguidance/ai";
import {
  APPLICATION_DATABASE_ROLE,
  createDatabaseClient,
  isValidEncryptionKey,
} from "@starguidance/database";

import { isHostedNetlifyRuntime, isLocalRuntimeAdapterAuthorized } from "@/lib/hosted-runtime";
import {
  guestTrialKeySource,
  isValidGuestTrialSecret,
  type GuestTrialKeySource,
} from "@/lib/guest-reading-security";
import { profileEngineBaseUrl } from "@/lib/profile-engine";
import { findServiceUrlProblem } from "@/lib/service-url";
import { isWeakSharedSecret } from "@/lib/shared-secret";
import { getRuntimeConfiguration, interpretationRuntimeOptions } from "@/lib/runtime-configuration";

const REQUIRED_STAGING_ENVIRONMENT = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "DATABASE_URL",
  "DATA_ENCRYPTION_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "PROFILE_ENGINE_URL",
  "PROFILE_ENGINE_SHARED_SECRET",
  "READINESS_PROBE_SECRET",
  // Load-bearing since migration 0007: the drain route
  // (api/internal/interpretation-jobs) rejects every request when this is
  // absent or weak, and NEXT_PUBLIC_APP_URL is what the Netlify-scheduled
  // trigger targets. Neither is new to production — this closes a
  // pre-existing readiness-gate gap rather than gating a new feature.
  "INTERPRETATION_WORKER_SECRET",
  "NEXT_PUBLIC_APP_URL",
] as const;

const APPROVED_STAGING_MODEL_CHAIN = [
  "openai/gpt-oss-120b",
  "llama-3.3-70b-versatile",
  "openai/gpt-oss-20b",
] as const;
const APPROVED_STAGING_BASE_URL = "https://api.groq.com/openai/v1";
const APPROVED_STAGING_ATTEMPT_TIMEOUT_MS = 15_000;
const APPROVED_STAGING_TOTAL_TIMEOUT_MS = 40_000;
const APPROVED_STAGING_MAX_OUTPUT_TOKENS = 2_600;

function effectivePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function approvedStagingModelChainConfigured(): boolean {
  const configured = configuredGroqModelChain();
  return (
    configured.length === APPROVED_STAGING_MODEL_CHAIN.length &&
    configured.every((model, index) => model === APPROVED_STAGING_MODEL_CHAIN[index])
  );
}

function approvedStagingProviderBudgetConfigured(): boolean {
  const route = configuredAiProviderRoute();
  const baseUrl =
    process.env.AI_PROVIDER_BASE_URL?.trim().replace(/\/+$/, "") || APPROVED_STAGING_BASE_URL;
  return (
    route.kind === "direct-groq" &&
    route.transport === "direct" &&
    route.invalidEnvironmentVariables.length === 0 &&
    baseUrl === APPROVED_STAGING_BASE_URL &&
    effectivePositiveInteger(
      process.env.AI_PROVIDER_TIMEOUT_MS,
      APPROVED_STAGING_ATTEMPT_TIMEOUT_MS,
    ) === APPROVED_STAGING_ATTEMPT_TIMEOUT_MS &&
    effectivePositiveInteger(
      process.env.AI_PROVIDER_TOTAL_TIMEOUT_MS,
      APPROVED_STAGING_TOTAL_TIMEOUT_MS,
    ) === APPROVED_STAGING_TOTAL_TIMEOUT_MS &&
    effectivePositiveInteger(
      process.env.AI_PROVIDER_MAX_OUTPUT_TOKENS,
      APPROVED_STAGING_MAX_OUTPUT_TOKENS,
    ) === APPROVED_STAGING_MAX_OUTPUT_TOKENS
  );
}

function approvedGatewayProviderBudgetConfigured(): boolean {
  const route = configuredAiProviderRoute();
  return (
    route.kind === "access-gateway" &&
    route.transport === "tokenpak" &&
    route.invalidEnvironmentVariables.length === 0 &&
    effectivePositiveInteger(
      process.env.AI_PROVIDER_TIMEOUT_MS,
      APPROVED_STAGING_ATTEMPT_TIMEOUT_MS,
    ) === APPROVED_STAGING_ATTEMPT_TIMEOUT_MS &&
    effectivePositiveInteger(
      process.env.AI_PROVIDER_TOTAL_TIMEOUT_MS,
      APPROVED_STAGING_TOTAL_TIMEOUT_MS,
    ) === APPROVED_STAGING_TOTAL_TIMEOUT_MS &&
    effectivePositiveInteger(
      process.env.AI_PROVIDER_MAX_OUTPUT_TOKENS,
      APPROVED_STAGING_MAX_OUTPUT_TOKENS,
    ) === APPROVED_STAGING_MAX_OUTPUT_TOKENS
  );
}

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

const READINESS_TOKEN_CONTEXT = "starguidance-readiness-v1";

function readinessAuthorized(request: Request): boolean {
  const secret = process.env.READINESS_PROBE_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || isWeakSharedSecret(secret) || !authorization?.startsWith("Bearer ")) return false;
  const received = authorization.slice("Bearer ".length);
  const expected = createHmac("sha256", secret).update(READINESS_TOKEN_CONTEXT).digest("base64url");
  const receivedBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  return (
    receivedBytes.length === expectedBytes.length && timingSafeEqual(receivedBytes, expectedBytes)
  );
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
  // Readiness must not reserve a multi-connection pool of its own in a
  // serverless function; it performs one query and one actor transaction.
  const client = createDatabaseClient(databaseUrl, { max: 1, idleTimeoutSeconds: 2 });
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
          and to_regclass('public.product_events') is not null
          and to_regclass('public.runtime_configuration_versions') is not null
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'birth_profiles'
              and column_name = 'active_snapshot_id'
          )
          and not exists (
            select required.column_name
            from unnest(array['kind', 'outcome_status', 'behavior_changed']) as required(column_name)
            where not exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'reading_feedback'
                and columns.column_name = required.column_name
            )
          )
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'reading_sessions'
              and column_name = 'reading_lens'
          )
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'reading_sessions'
              and column_name = 'idempotency_key'
          )
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'reading_outputs'
              and column_name = 'safety_policy_version'
          )
          and not exists (
            select required.column_name
            from unnest(array[
              'provider_id', 'prompt_version', 'content_version',
              'safety_policy_version', 'schema_version'
            ]) as required(column_name)
            where not exists (
              select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'follow_up_questions'
                and columns.column_name = required.column_name
            )
          )
          and to_regclass('public.birth_profiles_user_unique') is not null
          and to_regclass('public.follow_up_questions_reading_idx') is not null
          and to_regclass('public.reading_sessions_user_idempotency_unique') is not null
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'decks'
              and column_name = 'active'
          )
          and exists (
            select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'spreads'
              and column_name = 'active'
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
            or has_table_privilege('authenticated', 'public.product_events', 'select')
            or has_table_privilege('authenticated', 'public.runtime_configuration_versions', 'select')
          )
        ) as schema_ready,
        not exists (
          select 1
          from unnest(array[
            'users', 'consents', 'birth_profiles', 'profile_snapshots',
            'profile_components', 'profile_traits', 'product_events',
            'runtime_configuration_versions'
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

export async function GET(request: Request) {
  const stagingPreview = process.env.APP_ENV === "staging" && isHostedNetlifyRuntime();
  const deployedCommit = stagingPreview ? (process.env.DEPLOYED_COMMIT_REF ?? null) || null : null;
  if (new URL(request.url).searchParams.get("readiness") !== "1")
    return NextResponse.json(
      {
        status: "ok",
        kind: "liveness",
        stagingPreview,
        deployedCommit,
        appEnvironment: appEnvironment(),
        runtimeAdapter: runtimeAdapter(),
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );

  if (!readinessAuthorized(request))
    return NextResponse.json(
      { status: "unauthorized", kind: "readiness" },
      { status: 401, headers: { "cache-control": "no-store", "www-authenticate": "Bearer" } },
    );

  const runtimeConfiguration = await getRuntimeConfiguration().catch(() => undefined);
  const runtimeConfigurationReady = Boolean(
    runtimeConfiguration &&
    Object.values(runtimeConfiguration.versions).every((version) => version !== null),
  );
  const interpretationProviderId = createInterpretationProvider(
    runtimeConfiguration ? interpretationRuntimeOptions(runtimeConfiguration) : { enabled: false },
  ).id;
  const interpretation = {
    providerKind:
      interpretationProviderId.startsWith("groq:") ||
      interpretationProviderId.startsWith("groq-gateway:")
        ? "groq"
        : "deterministic",
    transport: interpretationProviderId.startsWith("groq-gateway:")
      ? "access-gateway"
      : interpretationProviderId.startsWith("groq:")
        ? "direct-groq"
        : "deterministic",
    approvedLiveProviderConfigured:
      (interpretationProviderId === `groq:${APPROVED_STAGING_MODEL_CHAIN[0]}` ||
        interpretationProviderId === `groq-gateway:${APPROVED_STAGING_MODEL_CHAIN[0]}`) &&
      approvedStagingModelChainConfigured() &&
      (approvedStagingProviderBudgetConfigured() || approvedGatewayProviderBudgetConfigured()),
  };
  const requiredEnvironment = REQUIRED_STAGING_ENVIRONMENT.map((name) => ({
    name,
    present: configured(name),
  }));
  const missingEnvironmentVariables: string[] = requiredEnvironment
    .filter(({ present }) => !present)
    .map(({ name }) => name);
  const invalidEnvironmentVariables: string[] = [];
  let guestTrialSource: GuestTrialKeySource | null = null;
  if (process.env.AI_PROVIDER?.trim() === "groq")
    invalidEnvironmentVariables.push(...configuredAiProviderRoute().invalidEnvironmentVariables);
  if (configured("DATA_ENCRYPTION_KEY")) {
    if (!isValidEncryptionKey(process.env.DATA_ENCRYPTION_KEY as string))
      invalidEnvironmentVariables.push("DATA_ENCRYPTION_KEY");
  }
  if (configured("GUEST_TRIAL_SECRET")) {
    if (!isValidGuestTrialSecret(process.env.GUEST_TRIAL_SECRET))
      invalidEnvironmentVariables.push("GUEST_TRIAL_SECRET");
  }
  try {
    guestTrialSource = guestTrialKeySource();
  } catch {
    if (!configured("GUEST_TRIAL_SECRET")) missingEnvironmentVariables.push("GUEST_TRIAL_SECRET");
  }
  if (configured("DATA_ENCRYPTION_KEYS_PREVIOUS")) {
    const previous = (process.env.DATA_ENCRYPTION_KEYS_PREVIOUS as string)
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (previous.length > 3 || previous.some((key) => !isValidEncryptionKey(key)))
      invalidEnvironmentVariables.push("DATA_ENCRYPTION_KEYS_PREVIOUS");
  }
  // Same helper the drain route's own authorized() check uses. This only
  // proves the Next.js app's copy of the secret is strong — it cannot
  // confirm the separately-configured Netlify Function has a matching value
  // in its own runtime environment; that remains an owner action item.
  if (configured("INTERPRETATION_WORKER_SECRET")) {
    if (isWeakSharedSecret(process.env.INTERPRETATION_WORKER_SECRET))
      invalidEnvironmentVariables.push("INTERPRETATION_WORKER_SECRET");
  }
  if (configured("READINESS_PROBE_SECRET")) {
    if (isWeakSharedSecret(process.env.READINESS_PROBE_SECRET))
      invalidEnvironmentVariables.push("READINESS_PROBE_SECRET");
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
    database.connection &&
    database.schemaReady &&
    database.rlsReady &&
    database.actorTransactionReady &&
    runtimeConfigurationReady;

  const runtimeConfigurationStatus = {
    ready: runtimeConfigurationReady,
    versions: runtimeConfiguration?.versions ?? null,
  };

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      kind: "readiness",
      stagingPreview,
      // Build provenance, so staging verification can prove the preview it is
      // testing was built from the commit under test. Withheld in production:
      // a public deployment need not advertise which commit it runs.
      deployedCommit,
      appEnvironment: appEnvironment(),
      runtimeAdapter: runtimeAdapter(),
      localPersistenceEnabled: isLocalRuntimeAdapterAuthorized(),
      localAdapterExplicitlyAllowed: process.env.ALLOW_LOCAL_RUNTIME_ADAPTER === "true",
      requiredEnvironment,
      missingEnvironmentVariables,
      invalidEnvironmentVariables,
      guestTrial: {
        keySource: guestTrialSource,
      },
      // Report only a provider class and an approved-contract boolean. The
      // credential and arbitrary environment values never enter this payload.
      interpretation,
      runtimeConfiguration: runtimeConfigurationStatus,
      profileEngine,
      database,
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
