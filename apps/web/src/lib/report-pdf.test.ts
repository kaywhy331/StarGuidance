import { describe, expect, it } from "vitest";
import type { StoredReport } from "@starguidance/database";

import { buildReportDocumentModel } from "./report-document";
import { renderProfileReportPdf } from "./report-pdf";

const report: StoredReport = {
  id: "00000000-0000-4000-8000-000000000041",
  userId: "00000000-0000-4000-8000-000000000042",
  snapshotId: "00000000-0000-4000-8000-000000000043",
  orderId: "00000000-0000-4000-8000-000000000044",
  provider: "local",
  status: "ready",
  sections: [
    { key: "overview", title: "Personal overview", body: "Structured overview body." },
    {
      key: "western-astrology",
      title: "Western astrology",
      body: "No validated calculation is available.",
      unavailable: true,
    },
  ],
  createdAt: "2026-08-11T12:00:00.000Z",
};

describe("profile report PDF", () => {
  it("uses the exact structured web model for every PDF section", () => {
    const model = buildReportDocumentModel(report);
    expect(model.sections.map(({ key, title, body }) => ({ key, title, body }))).toEqual(
      report.sections.map(({ key, title, body }) => ({ key, title, body })),
    );
    expect(model.sections[1]?.statusLabel).toBe("Explicitly unavailable");
  });

  it("generates a tagged, language-declared PDF with document structure", async () => {
    const pdf = await renderProfileReportPdf(report);
    const source = pdf.toString("latin1");
    expect(source.startsWith("%PDF-1.7")).toBe(true);
    expect(source).toContain("/StructTreeRoot");
    expect(source).toContain("/MarkInfo");
    expect(source).toMatch(/\/Lang\s*\(en-US\)/);
    expect(source).toContain("/DisplayDocTitle true");
  });
});
