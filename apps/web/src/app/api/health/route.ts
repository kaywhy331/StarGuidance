import { NextResponse } from "next/server";

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
  if (!baseUrl) return { healthStatus: null, unauthorizedComputeStatus: null };

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

  const [healthStatus, unauthorizedComputeStatus] = await Promise.all([
    probe("/health"),
    probe("/v1/profile/compute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        full_birth_name: "Synthetic Verification",
        birth_date: "2000-01-01",
        birth_time: { kind: "unknown" },
      }),
    }),
  ]);
  return { healthStatus, unauthorizedComputeStatus };
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
    : { healthStatus: null, unauthorizedComputeStatus: null };
  const healthy =
    stagingPreview &&
    runtimeAdapter() === "supabase" &&
    !isLocalRuntimeAdapterAuthorized() &&
    process.env.ALLOW_LOCAL_RUNTIME_ADAPTER !== "true" &&
    missingEnvironmentVariables.length === 0 &&
    invalidEnvironmentVariables.length === 0 &&
    profileEngine.healthStatus === 200 &&
    profileEngine.unauthorizedComputeStatus === 401;

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
    },
    { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
