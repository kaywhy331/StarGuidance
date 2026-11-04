import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = vi.fn();
  const client = Object.assign(vi.fn(), {
    begin: vi.fn(),
  });
  return {
    assertRateLimit: vi.fn(),
    assertSameOrigin: vi.fn(),
    client,
    inspectJobQueues: vi.fn(),
    getRuntimeConfiguration: vi.fn(),
    reenqueueInterpretationJob: vi.fn(),
    reenqueueReportJob: vi.fn(),
    requestSecurityFailure: vi.fn(),
    requireOperationalRole: vi.fn(),
    requireUser: vi.fn(),
    transaction,
    tryRecordProductEvent: vi.fn(),
  };
});

vi.mock("@starguidance/database", () => ({
  inspectJobQueues: mocks.inspectJobQueues,
  reenqueueInterpretationJob: mocks.reenqueueInterpretationJob,
  reenqueueReportJob: mocks.reenqueueReportJob,
}));

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/operational-access", () => ({
  OPERATIONAL_ACCESS_DENIED: "OPERATIONAL_ACCESS_DENIED",
  requireOperationalRole: mocks.requireOperationalRole,
}));
vi.mock("@/lib/request-security", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertSameOrigin: mocks.assertSameOrigin,
  requestSecurityFailure: mocks.requestSecurityFailure,
}));
vi.mock("@/lib/product-telemetry", () => ({
  tryRecordProductEvent: mocks.tryRecordProductEvent,
}));
vi.mock("@/lib/runtime", () => ({
  getRuntimeAdapter: () => "supabase",
  getSystemDatabaseClient: () => mocks.client,
}));
vi.mock("@/lib/runtime-configuration", () => ({
  getRuntimeConfiguration: mocks.getRuntimeConfiguration,
  interpretationRuntimeOptions: (configuration: {
    models: {
      liveAiEnabled: boolean;
      primaryModel: string;
      fallbackModels: string[];
      disabledModels: string[];
    };
    prompts: { bundleId: string };
  }) => ({
    enabled: configuration.models.liveAiEnabled,
    modelChain: [configuration.models.primaryModel, ...configuration.models.fallbackModels].filter(
      (model) => !configuration.models.disabledModels.includes(model),
    ),
    promptBundleId: configuration.prompts.bundleId,
  }),
  profileReportsEnabled: (configuration: { features: { profileReportsEnabled: boolean } }) =>
    configuration.features.profileReportsEnabled,
}));

import { GET, POST } from "./route";

const userId = "00000000-0000-4000-8000-000000000101";
const targetId = "00000000-0000-4000-8000-000000000102";

function getRequest(traceId?: string): Request {
  return new Request(
    `https://starguidance.test/api/operations${traceId ? `?traceId=${traceId}` : ""}`,
  );
}

function retryRequest(queue: "interpretation" | "report" = "interpretation"): Request {
  return new Request("https://starguidance.test/api/operations", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://starguidance.test" },
    body: JSON.stringify({ action: "retry-job", queue, targetId }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: userId, email: "operator@starguidance.test" });
  mocks.requireOperationalRole.mockImplementation(
    async (_minimum: string, user: { id: string; email: string }) => ({
      ...user,
      operationalRole: "operator",
    }),
  );
  mocks.inspectJobQueues.mockResolvedValue({
    interpretation: { statuses: { failed: 1 }, failedByClass: { provider_timeout: 1 } },
    report: { statuses: { pending: 2 }, failedByClass: {} },
  });
  mocks.getRuntimeConfiguration.mockResolvedValue({
    content: { enabledSpreadIds: ["one-card", "three-card"] },
    prompts: { bundleId: "reader-voice-v3" },
    commerce: {
      readingAccessMode: "free-window",
      freeAllowance: 2,
      allowanceWindowHours: 48,
    },
    features: { profileReportsEnabled: false, animationVariant: "immersive-v1" },
    models: {
      liveAiEnabled: true,
      primaryModel: "openai/gpt-oss-120b",
      fallbackModels: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"],
      disabledModels: [],
    },
    versions: { content: null, prompts: null, commerce: null, features: null, models: null },
  });
  mocks.client.begin.mockImplementation(
    async (work: (transaction: typeof mocks.transaction) => Promise<unknown>) =>
      work(mocks.transaction),
  );
  mocks.client.mockResolvedValue([]);
  mocks.transaction.mockResolvedValue([]);
  mocks.reenqueueReportJob.mockResolvedValue(true);
});

afterEach(() => vi.unstubAllEnvs());

describe("operational API boundary", () => {
  it("returns aggregate status and read-only effective configuration", async () => {
    vi.stubEnv("READING_ACCESS_MODE", "free-window");
    vi.stubEnv("READING_FREE_ALLOWANCE", "2");
    vi.stubEnv("READING_ALLOWANCE_WINDOW_HOURS", "48");
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("AI_PROVIDER_API_KEY", "synthetic-provider-key");
    vi.stubEnv("AI_SAFETY_EVALUATION_APPROVED", "true");
    vi.stubEnv("AI_PROVIDER_MODEL", "openai/gpt-oss-120b");
    vi.stubEnv("AI_PROVIDER_FALLBACK_MODELS", "llama-3.3-70b-versatile,openai/gpt-oss-20b");

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      role: "operator",
      diagnostics: {
        interpretation: { statuses: { failed: 1 } },
        report: { statuses: { pending: 2 } },
      },
      productMeasurement: { windowHours: 24, events: {} },
      trace: null,
      configuration: {
        aiGenerationEnabled: true,
        aiTransport: "direct-groq",
        aiModels: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "openai/gpt-oss-20b"],
        readingAccessMode: "free-window",
        freeAllowance: 2,
        allowanceWindowHours: 48,
        operationalAlertReceiverSet: false,
        liveAiVolumeAlertThreshold: 500,
      },
    });
  });

  it("reports an approved gateway as live without requiring a direct Groq key", async () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("AI_PROVIDER_API_KEY", "");
    vi.stubEnv("AI_PROVIDER_BASE_URL", "https://reader-gateway.example.test/v1");
    vi.stubEnv("AI_PROVIDER_TRANSPORT", "tokenpak");
    vi.stubEnv("AI_PROVIDER_GATEWAY_HOST", "reader-gateway.example.test");
    vi.stubEnv("AI_PROVIDER_GATEWAY_APPROVED", "true");
    vi.stubEnv("AI_PROVIDER_GATEWAY_KEY", "synthetic-gateway-key-at-least-32-bytes");
    vi.stubEnv("AI_PROVIDER_CF_ACCESS_CLIENT_ID", "synthetic-access-client-id");
    vi.stubEnv(
      "AI_PROVIDER_CF_ACCESS_CLIENT_SECRET",
      "synthetic-access-client-secret-at-least-32-bytes",
    );
    vi.stubEnv("AI_SAFETY_EVALUATION_APPROVED", "true");

    const response = await GET(getRequest());
    const body = await response.json();

    expect(body.configuration).toMatchObject({
      aiGenerationEnabled: true,
      aiTransport: "access-gateway",
    });
  });

  it("reports an unsafe mixed provider configuration as deterministic", async () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("AI_PROVIDER_API_KEY", "provider-key-must-not-coexist");
    vi.stubEnv("AI_PROVIDER_BASE_URL", "https://reader-gateway.example.test/v1");
    vi.stubEnv("AI_PROVIDER_TRANSPORT", "tokenpak");
    vi.stubEnv("AI_PROVIDER_GATEWAY_HOST", "reader-gateway.example.test");
    vi.stubEnv("AI_PROVIDER_GATEWAY_APPROVED", "true");
    vi.stubEnv("AI_PROVIDER_GATEWAY_KEY", "synthetic-gateway-key-at-least-32-bytes");
    vi.stubEnv("AI_PROVIDER_CF_ACCESS_CLIENT_ID", "synthetic-access-client-id");
    vi.stubEnv(
      "AI_PROVIDER_CF_ACCESS_CLIENT_SECRET",
      "synthetic-access-client-secret-at-least-32-bytes",
    );
    vi.stubEnv("AI_SAFETY_EVALUATION_APPROVED", "true");

    const body = await (await GET(getRequest())).json();
    expect(body.configuration).toMatchObject({
      aiGenerationEnabled: false,
      aiTransport: "deterministic",
    });
  });

  it("reduces an exact trace lookup to type, status, and timestamp", async () => {
    mocks.client.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        entity_type: "report-job",
        status: "failed",
        created_at: new Date("2026-08-11T12:00:00.000Z"),
        user_id: "must-not-cross-boundary",
        last_error: "must-not-cross-boundary",
      },
    ]);

    const response = await GET(getRequest(targetId));
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(serialized).toContain('"type":"report-job"');
    expect(serialized).toContain('"status":"failed"');
    expect(serialized).not.toContain("must-not-cross-boundary");
  });

  it("commits a failed-job retry and its audit receipt in one transaction", async () => {
    mocks.transaction.mockResolvedValueOnce([{ status: "failed" }]).mockResolvedValueOnce([]);

    const response = await POST(retryRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ retried: true, queue: "interpretation", targetId });
    expect(mocks.reenqueueInterpretationJob).toHaveBeenCalledWith(mocks.transaction, targetId);
    expect(mocks.client.begin).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    const auditSql = (mocks.transaction.mock.calls[1]?.[0] as TemplateStringsArray).join(" ");
    expect(auditSql).toContain("insert into audit_events");
    expect(mocks.transaction.mock.calls[1]?.slice(1)).toEqual([
      userId,
      "interpretation-job",
      targetId,
    ]);
    expect(mocks.tryRecordProductEvent).toHaveBeenCalledWith(
      expect.objectContaining({ name: "job_retried" }),
    );
  });

  it("does not retry or audit a job that is no longer failed", async () => {
    mocks.transaction.mockResolvedValueOnce([{ status: "pending" }]);

    const response = await POST(retryRequest("report"));

    expect(response.status).toBe(409);
    expect(mocks.reenqueueReportJob).not.toHaveBeenCalled();
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("keeps support-only identities out of mutation and the database transaction", async () => {
    mocks.requireOperationalRole.mockRejectedValueOnce(new Error("OPERATIONAL_ACCESS_DENIED"));

    const response = await POST(retryRequest());

    expect(response.status).toBe(403);
    expect(mocks.client.begin).not.toHaveBeenCalled();
  });
});
