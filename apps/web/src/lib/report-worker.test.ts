import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actorTransaction: vi.fn(),
  claimReportJobs: vi.fn(),
  completeReportJob: vi.fn(),
  failReportJob: vi.fn(),
  markReportGenerationFailed: vi.fn(),
  writeReportResult: vi.fn(),
  getRuntimeAdapter: vi.fn(),
  readProfileReportSource: vi.fn(),
  buildProfileReportSections: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@starguidance/database", () => ({
  actorTransaction: mocks.actorTransaction,
  claimReportJobs: mocks.claimReportJobs,
  completeReportJob: mocks.completeReportJob,
  failReportJob: mocks.failReportJob,
  markReportGenerationFailed: mocks.markReportGenerationFailed,
  writeReportResult: mocks.writeReportResult,
}));

vi.mock("./runtime", () => ({
  getRuntimeAdapter: mocks.getRuntimeAdapter,
  getSystemDatabaseClient: () => "synthetic-system-client",
}));

vi.mock("./report", () => ({
  readProfileReportSource: mocks.readProfileReportSource,
  buildProfileReportSections: mocks.buildProfileReportSections,
}));

vi.mock("./persistence", () => ({ recordAudit: mocks.recordAudit }));

import { runReportJobs } from "./report-worker";

const job = {
  id: "7678d04f-1baf-4e78-a1ab-98b76e11ab1a",
  userId: "2ae1a2ff-e5db-4e31-a504-ad0d8f82780d",
  reportId: "0b9123c5-f01f-401a-b9da-13ae48d64282",
  encryptedSource: "encrypted-source",
  attemptCount: 1,
  maxAttempts: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getRuntimeAdapter.mockReturnValue("supabase");
  mocks.claimReportJobs.mockResolvedValue([]);
  mocks.readProfileReportSource.mockReturnValue({ source: true });
  mocks.buildProfileReportSections.mockReturnValue([{ key: "overview" }]);
  mocks.failReportJob.mockResolvedValue({ terminal: false });
  mocks.actorTransaction.mockImplementation(
    async (_client: unknown, _userId: string, work: (tx: unknown) => Promise<unknown>) =>
      work("synthetic-actor-transaction"),
  );
});

describe("report job worker", () => {
  it("does not claim database jobs under the credential-free local adapter", async () => {
    mocks.getRuntimeAdapter.mockReturnValue("local");
    expect(await runReportJobs(10)).toEqual({ claimed: 0, succeeded: 0, failed: 0 });
    expect(mocks.claimReportJobs).not.toHaveBeenCalled();
  });

  it("builds, writes, audits, and completes a claimed report", async () => {
    mocks.claimReportJobs.mockResolvedValue([job]);

    expect(await runReportJobs(10)).toEqual({ claimed: 1, succeeded: 1, failed: 0 });
    expect(mocks.readProfileReportSource).toHaveBeenCalledWith({
      userId: job.userId,
      encryptedSource: job.encryptedSource,
    });
    expect(mocks.writeReportResult).toHaveBeenCalledWith(
      "synthetic-actor-transaction",
      expect.objectContaining({ userId: job.userId, reportId: job.reportId }),
    );
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      job.userId,
      "report.generated",
      "report",
      job.reportId,
    );
    expect(mocks.completeReportJob).toHaveBeenCalledWith("synthetic-system-client", job.id);
  });

  it("records only a fixed failure class and leaves a transient job retryable", async () => {
    mocks.claimReportJobs.mockResolvedValue([job]);
    mocks.readProfileReportSource.mockImplementation(() => {
      throw new Error("private implementation detail");
    });

    expect(await runReportJobs(10)).toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(mocks.failReportJob).toHaveBeenCalledWith(
      "synthetic-system-client",
      job,
      "report_generation_failed",
    );
    expect(mocks.markReportGenerationFailed).not.toHaveBeenCalled();
  });

  it("marks the report failed only after the durable job exhausts retries", async () => {
    mocks.claimReportJobs.mockResolvedValue([job]);
    mocks.buildProfileReportSections.mockImplementation(() => {
      throw new Error("template failure");
    });
    mocks.failReportJob.mockResolvedValue({ terminal: true });

    expect(await runReportJobs(10)).toEqual({ claimed: 1, succeeded: 0, failed: 1 });
    expect(mocks.markReportGenerationFailed).toHaveBeenCalledWith("synthetic-actor-transaction", {
      userId: job.userId,
      reportId: job.reportId,
    });
  });
});
