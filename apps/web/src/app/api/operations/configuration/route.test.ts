import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = Object.assign(vi.fn(), {
    json: (value: unknown) => value,
    unsafe: vi.fn(),
  });
  const client = Object.assign(vi.fn(), {
    begin: vi.fn(),
    json: (value: unknown) => value,
  });
  return {
    assertRateLimit: vi.fn(),
    assertSameOrigin: vi.fn(),
    client,
    getRuntimeConfiguration: vi.fn(),
    requestSecurityFailure: vi.fn(),
    requireOperationalRole: vi.fn(),
    requireUser: vi.fn(),
    transaction,
  };
});

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
vi.mock("@/lib/runtime", () => ({
  getRuntimeAdapter: () => "supabase",
  getSystemDatabaseClient: () => mocks.client,
}));
vi.mock("@/lib/runtime-configuration", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/runtime-configuration")>()),
  getRuntimeConfiguration: mocks.getRuntimeConfiguration,
}));

import { GET, POST } from "./route";

const operatorId = "00000000-0000-4000-8000-000000000201";
const otherOperatorId = "00000000-0000-4000-8000-000000000202";
const configurationId = "00000000-0000-4000-8000-000000000203";

const effective = {
  content: {
    deckVersion: "starguidance-illustrated-v3",
    cardSetVersion: "starguidance-illustrated-v3",
    tarotContentVersion: "starguidance-original-v1",
    spreadCatalogVersion: "starguidance-spreads-v2",
    interpretationRulesVersion: "interpretation-rules-v1",
    enabledSpreadIds: [
      "one-card",
      "three-card",
      "celtic-cross",
      "horseshoe",
      "relationship",
      "nine-card-matrix",
    ],
  },
  prompts: { bundleId: "reader-voice-v3", safetyPolicyVersion: "question-safety-v2" },
  commerce: {
    readingAccessMode: "unlimited",
    freeAllowance: 3,
    allowanceWindowHours: 24,
    followUpLimit: 1,
    rereadCooldownMinutes: 30,
    reportProductId: "profile-report-v1",
    currency: "USD",
    priceMinor: 2900,
  },
  features: {
    profileReportsEnabled: false,
    animationsEnabled: true,
    animationVariant: "immersive-v1",
    enabledProfileSystems: ["numerology", "dreamspell"],
  },
  models: {
    liveAiEnabled: true,
    primaryModel: "approved-primary",
    fallbackModels: ["approved-fallback"],
    disabledModels: [],
  },
  versions: { content: null, prompts: null, commerce: null, features: null, models: null },
};

function request(body: unknown) {
  return new Request("https://starguidance.test/api/operations/configuration", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://starguidance.test" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AI_PROVIDER_ALLOWED_MODELS", "approved-primary,approved-fallback");
  mocks.requireUser.mockResolvedValue({ id: operatorId, email: "operator@example.test" });
  mocks.requireOperationalRole.mockImplementation(async (_role: string, user: object) => ({
    ...user,
    operationalRole: "operator",
  }));
  mocks.getRuntimeConfiguration.mockResolvedValue(structuredClone(effective));
  mocks.requestSecurityFailure.mockReturnValue(undefined);
  mocks.client.begin.mockImplementation(
    async (work: (transaction: typeof mocks.transaction) => Promise<unknown>) =>
      work(mocks.transaction),
  );
  mocks.client.mockImplementation((strings: TemplateStringsArray) => {
    const sql = strings.join(" ");
    if (sql.includes("from runtime_configuration_versions"))
      return Promise.resolve([
        {
          id: configurationId,
          domain: "features",
          version: 1,
          status: "draft",
          payload: effective.features,
          created_by: otherOperatorId,
          approved_by: null,
          approved_at: null,
          published_at: null,
          created_at: new Date("2026-08-20T12:00:00.000Z"),
        },
      ]);
    if (sql.includes("from decks"))
      return Promise.resolve([{ target_type: "spread", id: "one-card", active: true }]);
    return Promise.resolve([]);
  });
  mocks.transaction.mockResolvedValue([]);
  mocks.transaction.unsafe.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

describe("governed runtime configuration API", () => {
  it("returns reviewed payloads without exposing operator identifiers", async () => {
    const response = await GET();
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(serialized).toContain('"approvalPolicy"');
    expect(serialized).toContain('"createdByCurrentOperator":false');
    expect(serialized).not.toContain(otherOperatorId);
    const contentSql = mocks.client.mock.calls
      .map(([strings]) => (strings as TemplateStringsArray).join(" "))
      .find((sql) => sql.includes("from decks"));
    expect(contentSql).toContain("bool_and(active) as active from spreads group by id");
  });

  it("creates a validated immutable draft and audit receipt in one transaction", async () => {
    mocks.transaction
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ version: 2 }])
      .mockResolvedValueOnce([{ id: configurationId, version: 2 }])
      .mockResolvedValueOnce([]);

    const response = await POST(
      request({ action: "create-draft", domain: "features", payload: effective.features }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ created: true, version: 2 });
    expect(mocks.client.begin).toHaveBeenCalledTimes(1);
    const insertSql = (mocks.transaction.mock.calls[2]?.[0] as TemplateStringsArray).join(" ");
    const auditSql = (mocks.transaction.mock.calls[3]?.[0] as TemplateStringsArray).join(" ");
    expect(insertSql).toContain("insert into runtime_configuration_versions");
    expect(auditSql).toContain("insert into audit_events");
  });

  it("rejects unknown configuration fields before opening a transaction", async () => {
    const response = await POST(
      request({
        action: "create-draft",
        domain: "features",
        payload: { ...effective.features, unsafeExperiment: true },
      }),
    );
    expect(response.status).toBe(422);
    expect(mocks.client.begin).not.toHaveBeenCalled();
  });

  it("prevents a draft author from self-approving", async () => {
    mocks.transaction.mockResolvedValueOnce([
      {
        id: configurationId,
        domain: "features",
        version: 1,
        status: "draft",
        created_by: operatorId,
      },
    ]);

    const response = await POST(request({ action: "approve", configurationId }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("second operator");
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("publishes only a separately approved version and archives the prior release atomically", async () => {
    mocks.transaction
      .mockResolvedValueOnce([
        {
          id: configurationId,
          domain: "models",
          version: 3,
          status: "approved",
          approved_by: otherOperatorId,
          payload: effective.models,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await POST(request({ action: "publish", configurationId }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ published: true });
    expect((mocks.transaction.mock.calls[2]?.[0] as TemplateStringsArray).join(" ")).toContain(
      "status = 'archived'",
    );
    expect((mocks.transaction.mock.calls[3]?.[0] as TemplateStringsArray).join(" ")).toContain(
      "status = 'published'",
    );
  });

  it("can roll back to the audited system-bootstrap release", async () => {
    mocks.transaction
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: configurationId,
          domain: "content",
          version: 1,
          status: "archived",
          created_by: null,
          approved_by: null,
          approved_at: new Date("2026-08-20T00:00:00.000Z"),
          payload: effective.content,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await POST(
      request({
        action: "rollback",
        domain: "content",
        targetVersion: 1,
        confirmation: "ROLL BACK",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rolledBack: true });
    expect((mocks.transaction.mock.calls[4]?.[0] as TemplateStringsArray).join(" ")).toContain(
      "operations.configuration.rolled_back",
    );
  });

  it("refuses to publish a previously approved payload the current deployment cannot parse", async () => {
    mocks.transaction.mockResolvedValueOnce([
      {
        id: configurationId,
        domain: "prompts",
        version: 2,
        status: "approved",
        approved_by: otherOperatorId,
        payload: {
          bundleId: "retired-unreviewed-prompt",
          safetyPolicyVersion: "question-safety-v2",
        },
      },
    ]);

    const response = await POST(request({ action: "publish", configurationId }));

    expect(response.status).toBe(422);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
  });

  it("creates an audited, restrictive AI kill-switch version immediately", async () => {
    mocks.transaction
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ version: 5 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: configurationId, version: 5 }])
      .mockResolvedValueOnce([]);

    const response = await POST(
      request({ action: "kill-switch", targetType: "ai", confirmation: "DISABLE NOW" }),
    );
    expect(response.status).toBe(200);
    const insertArguments = mocks.transaction.mock.calls[3]?.slice(1);
    expect(JSON.stringify(insertArguments)).toContain('"liveAiEnabled":false');
    expect((mocks.transaction.mock.calls[4]?.[0] as TemplateStringsArray).join(" ")).toContain(
      "operations.kill_switch.activated",
    );
  });
});
