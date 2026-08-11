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
    reenqueueInterpretationJob: vi.fn(),
    reenqueueReportJob: vi.fn(),
    requestSecurityFailure: vi.fn(),
    requireOperationalRole: vi.fn(),
    requireUser: vi.fn(),
    transaction,
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
vi.mock("@/lib/runtime", () => ({
  getRuntimeAdapter: () => "supabase",
  getSystemDatabaseClient: () => mocks.client,
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

    const response = await GET(getRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      role: "operator",
      diagnostics: {
        interpretation: { statuses: { failed: 1 } },
        report: { statuses: { pending: 2 } },
      },
      trace: null,
      configuration: {
        readingAccessMode: "free-window",
        freeAllowance: "2",
        allowanceWindowHours: "48",
      },
    });
  });

  it("reduces an exact trace lookup to type, status, and timestamp", async () => {
    mocks.client.mockResolvedValue([
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
