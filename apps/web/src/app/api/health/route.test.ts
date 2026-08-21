import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const transaction = Object.assign(vi.fn(), { unsafe: vi.fn() });
  const client = {
    unsafe: vi.fn(),
    begin: vi.fn(async (work: (tx: typeof transaction) => Promise<void>) => work(transaction)),
    end: vi.fn().mockResolvedValue(undefined),
  };
  return { client, transaction };
});

vi.mock("@starguidance/database", () => ({
  APPLICATION_DATABASE_ROLE: "starguidance_app",
  createDatabaseClient: () => database.client,
  isValidEncryptionKey: (value: string) => Buffer.from(value, "base64").length === 32,
}));
vi.mock("@/lib/runtime-configuration", () => ({
  getRuntimeConfiguration: async () => ({
    content: { enabledSpreadIds: ["one-card"] },
    prompts: { bundleId: "reader-voice-v3" },
    commerce: {},
    features: {},
    models: {
      liveAiEnabled: true,
      primaryModel: "openai/gpt-oss-120b",
      fallbackModels: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"],
      disabledModels: [],
    },
    versions: { content: 1, prompts: 1, commerce: 1, features: 1, models: 1 },
  }),
  interpretationRuntimeOptions: (configuration: { prompts: { bundleId: string } }) => ({
    enabled: true,
    modelChain: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b"],
    promptBundleId: configuration.prompts.bundleId,
  }),
}));

import { GET } from "./route";

const SECRET_VALUES = {
  NEXT_PUBLIC_SUPABASE_URL: "https://synthetic.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon-key",
  DATABASE_URL: "postgresql://synthetic.invalid/database",
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
  GUEST_TRIAL_SECRET: Buffer.alloc(32, 17).toString("base64"),
  SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role-key",
  PROFILE_ENGINE_URL: "https://profile-engine.synthetic.invalid",
  PROFILE_ENGINE_SHARED_SECRET: "synthetic-profile-engine-shared-secret",
  READINESS_PROBE_SECRET: "synthetic-readiness-probe-shared-secret",
  AI_PROVIDER_API_KEY: "synthetic-ai-provider-key",
  INTERPRETATION_WORKER_SECRET: "synthetic-interpretation-worker-shared-secret",
  NEXT_PUBLIC_APP_URL: "https://app.synthetic.invalid",
} as const;

function configureStaging() {
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("RUNTIME_ADAPTER", "supabase");
  vi.stubEnv("SITE_ID", "synthetic-netlify-site-id");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "");
  vi.stubEnv("AI_PROVIDER", "groq");
  vi.stubEnv("AI_PROVIDER_MODEL", "openai/gpt-oss-120b");
  vi.stubEnv("AI_PROVIDER_FALLBACK_MODELS", "llama-3.3-70b-versatile,openai/gpt-oss-20b");
  vi.stubEnv("AI_PROVIDER_BASE_URL", "https://api.groq.com/openai/v1");
  vi.stubEnv("AI_PROVIDER_TIMEOUT_MS", "15000");
  vi.stubEnv("AI_PROVIDER_TOTAL_TIMEOUT_MS", "40000");
  vi.stubEnv("AI_PROVIDER_MAX_OUTPUT_TOKENS", "2600");
  vi.stubEnv("AI_SAFETY_EVALUATION_APPROVED", "true");
  for (const [name, value] of Object.entries(SECRET_VALUES)) vi.stubEnv(name, value);
}

function livenessRequest(): Request {
  return new Request("https://synthetic.invalid/api/health");
}

function readinessRequest(authorized = true): Request {
  const token = createHmac("sha256", SECRET_VALUES.READINESS_PROBE_SECRET)
    .update("starguidance-readiness-v1")
    .digest("base64url");
  return new Request("https://synthetic.invalid/api/health?readiness=1", {
    headers: authorized ? { authorization: `Bearer ${token}` } : {},
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
  database.client.begin.mockImplementation(
    async (work: (tx: typeof database.transaction) => Promise<void>) => work(database.transaction),
  );
  database.client.end.mockResolvedValue(undefined);
  database.transaction.mockResolvedValue([]);
  database.transaction.unsafe.mockResolvedValue([]);
});

describe("deployment health", () => {
  it("reports a configured staging runtime without returning environment values", async () => {
    configureStaging();
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const response = await GET(readinessRequest());
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      stagingPreview: true,
      appEnvironment: "staging",
      runtimeAdapter: "supabase",
      localPersistenceEnabled: false,
      localAdapterExplicitlyAllowed: false,
      missingEnvironmentVariables: [],
      invalidEnvironmentVariables: [],
      interpretation: {
        providerKind: "groq",
        transport: "direct-groq",
        approvedLiveProviderConfigured: true,
      },
      profileEngine: {
        healthStatus: 200,
        unauthorizedComputeStatus: 401,
        authorizedComputeStatus: 200,
      },
      database: {
        connection: true,
        schemaReady: true,
        rlsReady: true,
        actorTransactionReady: true,
      },
    });
    const readinessQuery = database.client.unsafe.mock.calls.at(0)?.at(0);
    expect(readinessQuery, "the actor role must remain a quoted SQL value").toContain(
      "rolname = 'starguidance_app'",
    );
    for (const value of Object.values(SECRET_VALUES)) expect(serialized).not.toContain(value);
  });

  it("fails readiness closed on a malformed guest-trial key", async () => {
    configureStaging();
    vi.stubEnv("GUEST_TRIAL_SECRET", "not-canonical-base64");
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const response = await GET(readinessRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.invalidEnvironmentVariables).toContain("GUEST_TRIAL_SECRET");
    expect(JSON.stringify(body)).not.toContain("not-canonical-base64");
  });

  it("stays ready on the deterministic fallback when live AI is unavailable", async () => {
    configureStaging();
    vi.stubEnv("AI_PROVIDER_API_KEY", "");
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const response = await GET(readinessRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.missingEnvironmentVariables).toEqual([]);
    expect(body.interpretation).toEqual({
      providerKind: "deterministic",
      transport: "deterministic",
      approvedLiveProviderConfigured: false,
    });
    expect(JSON.stringify(body)).not.toContain(SECRET_VALUES.AI_PROVIDER_API_KEY);
  });

  it("does not approve an unexpected live fallback model", async () => {
    configureStaging();
    vi.stubEnv("AI_PROVIDER_FALLBACK_MODELS", "llama-3.3-70b-versatile,unreviewed-model");
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const body = await (await GET(readinessRequest())).json();
    expect(body.interpretation).toEqual({
      providerKind: "groq",
      transport: "direct-groq",
      approvedLiveProviderConfigured: false,
    });
  });

  it("does not approve an unreviewed live-provider endpoint or budget", async () => {
    configureStaging();
    vi.stubEnv("AI_PROVIDER_BASE_URL", "https://example.invalid/openai/v1");
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const endpointBody = await (await GET(readinessRequest())).json();
    expect(endpointBody.interpretation.approvedLiveProviderConfigured).toBe(false);

    configureStaging();
    vi.stubEnv("AI_PROVIDER_TOTAL_TIMEOUT_MS", "120000");
    const budgetBody = await (await GET(readinessRequest())).json();
    expect(budgetBody.interpretation.approvedLiveProviderConfigured).toBe(false);
  });

  it("fails readiness closed on an unapproved or incomplete custom AI gateway", async () => {
    configureStaging();
    vi.stubEnv("AI_PROVIDER_API_KEY", "");
    vi.stubEnv("AI_PROVIDER_BASE_URL", "https://reader-gateway.synthetic.invalid/v1");
    vi.stubEnv("AI_PROVIDER_TRANSPORT", "tokenpak");
    vi.stubEnv("AI_PROVIDER_GATEWAY_HOST", "reader-gateway.synthetic.invalid");
    vi.stubEnv("AI_PROVIDER_GATEWAY_KEY", "short");
    vi.stubEnv("AI_PROVIDER_CF_ACCESS_CLIENT_ID", "synthetic-access-client-id");
    vi.stubEnv("AI_PROVIDER_CF_ACCESS_CLIENT_SECRET", "");
    vi.stubEnv("AI_PROVIDER_GATEWAY_APPROVED", "false");
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const response = await GET(readinessRequest());
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(body.interpretation).toEqual({
      providerKind: "deterministic",
      transport: "deterministic",
      approvedLiveProviderConfigured: false,
    });
    expect(body.invalidEnvironmentVariables).toEqual([
      "AI_PROVIDER_GATEWAY_APPROVED",
      "AI_PROVIDER_GATEWAY_KEY",
      "AI_PROVIDER_CF_ACCESS_CLIENT_SECRET",
    ]);
    expect(serialized).not.toContain("short");
    expect(serialized).not.toContain("synthetic-access-client-id");
  });

  it("does not send stale gateway credentials to the approved direct-Groq endpoint", async () => {
    configureStaging();
    vi.stubEnv("AI_PROVIDER_GATEWAY_KEY", "synthetic-gateway-key-at-least-32-bytes");
    vi.stubEnv("AI_PROVIDER_CF_ACCESS_CLIENT_ID", "synthetic-access-client-id");
    vi.stubEnv(
      "AI_PROVIDER_CF_ACCESS_CLIENT_SECRET",
      "synthetic-access-client-secret-at-least-32-bytes",
    );
    vi.stubEnv("AI_PROVIDER_GATEWAY_APPROVED", "true");
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const response = await GET(readinessRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.interpretation.providerKind).toBe("deterministic");
    expect(body.invalidEnvironmentVariables).toEqual([
      "AI_PROVIDER_GATEWAY_KEY",
      "AI_PROVIDER_CF_ACCESS_CLIENT_ID",
      "AI_PROVIDER_CF_ACCESS_CLIENT_SECRET",
      "AI_PROVIDER_GATEWAY_APPROVED",
    ]);
  });

  it("approves the reviewed model and budget contract over a complete Access gateway", async () => {
    configureStaging();
    vi.stubEnv("AI_PROVIDER_API_KEY", "");
    vi.stubEnv("AI_PROVIDER_BASE_URL", "https://reader-gateway.synthetic.invalid/v1");
    vi.stubEnv("AI_PROVIDER_TRANSPORT", "tokenpak");
    vi.stubEnv("AI_PROVIDER_GATEWAY_HOST", "reader-gateway.synthetic.invalid");
    vi.stubEnv("AI_PROVIDER_GATEWAY_KEY", "synthetic-gateway-key-at-least-32-bytes");
    vi.stubEnv("AI_PROVIDER_CF_ACCESS_CLIENT_ID", "synthetic-access-client-id");
    vi.stubEnv(
      "AI_PROVIDER_CF_ACCESS_CLIENT_SECRET",
      "synthetic-access-client-secret-at-least-32-bytes",
    );
    vi.stubEnv("AI_PROVIDER_GATEWAY_APPROVED", "true");
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const response = await GET(readinessRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.invalidEnvironmentVariables).toEqual([]);
    expect(body.interpretation).toEqual({
      providerKind: "groq",
      transport: "access-gateway",
      approvedLiveProviderConfigured: true,
    });
  });

  it("reports the build commit in staging and withholds it elsewhere", async () => {
    configureStaging();
    vi.stubEnv("DEPLOYED_COMMIT_REF", "0123456789abcdef0123456789abcdef01234567");
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const staging = await (await GET(livenessRequest())).json();
    expect(staging.deployedCommit, "staging verification proves which build it tested").toBe(
      "0123456789abcdef0123456789abcdef01234567",
    );

    // Outside a hosted staging preview the field must stay null, so a public
    // deployment never advertises the commit it runs.
    vi.stubEnv("APP_ENV", "production");
    const production = await (await GET(livenessRequest())).json();
    expect(production.deployedCommit).toBeNull();
  });

  it("returns only missing variable names when staging configuration is incomplete", async () => {
    configureStaging();
    vi.stubEnv("DATABASE_URL", "");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("redacted dependency failure")));

    const response = await GET(readinessRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.missingEnvironmentVariables).toEqual(["DATABASE_URL"]);
    expect(body.profileEngine).toEqual({
      healthStatus: null,
      unauthorizedComputeStatus: null,
      authorizedComputeStatus: null,
    });
    expect(body.database).toEqual({
      connection: false,
      schemaReady: false,
      rlsReady: false,
      actorTransactionReady: false,
    });
    expect(JSON.stringify(body)).not.toContain("redacted dependency failure");
  });

  it("never enables local persistence in a hosted preview", async () => {
    configureStaging();
    database.client.unsafe.mockResolvedValue([{ schema_ready: true, rls_ready: true }]);
    vi.stubEnv("RUNTIME_ADAPTER", "local");
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const response = await GET(readinessRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.localPersistenceEnabled).toBe(false);
  });

  it("fails closed when the authoritative staging schema is not applied", async () => {
    configureStaging();
    database.client.unsafe.mockResolvedValue([{ schema_ready: false, rls_ready: false }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(new Response(null, { status: 401 }))
        .mockResolvedValueOnce(new Response(null, { status: 200 })),
    );

    const response = await GET(readinessRequest());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.database).toEqual({
      connection: true,
      schemaReady: false,
      rlsReady: false,
      actorTransactionReady: false,
    });
  });

  it("keeps public liveness cheap and protects deep readiness", async () => {
    configureStaging();
    vi.stubGlobal("fetch", vi.fn());
    database.client.unsafe.mockClear();

    const liveness = await GET(livenessRequest());
    expect(liveness.status).toBe(200);
    expect(await liveness.json()).toMatchObject({ status: "ok", kind: "liveness" });
    expect(database.client.unsafe).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    const unauthorized = await GET(readinessRequest(false));
    expect(unauthorized.status).toBe(401);
    expect(await unauthorized.json()).toEqual({ status: "unauthorized", kind: "readiness" });
    expect(database.client.unsafe).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not accept the profile-engine credential at the readiness trust boundary", async () => {
    configureStaging();
    const wrongDomainToken = createHmac("sha256", SECRET_VALUES.PROFILE_ENGINE_SHARED_SECRET)
      .update("starguidance-readiness-v1")
      .digest("base64url");
    const response = await GET(
      new Request("https://synthetic.invalid/api/health?readiness=1", {
        headers: { authorization: `Bearer ${wrongDomainToken}` },
      }),
    );

    expect(response.status).toBe(401);
    expect(database.client.unsafe).not.toHaveBeenCalled();
  });
});
