import type { StoredReport, StoredReportSection } from "@starguidance/database";

export interface ReportDocumentSection extends StoredReportSection {
  statusLabel?: "Explicitly unavailable";
}

export interface ReportDocumentModel {
  title: string;
  eyebrow: string;
  sections: ReportDocumentSection[];
}

/**
 * The only presentation model for both web and PDF report output. Keeping
 * provider labeling and unavailable-state copy here makes content parity a
 * structural property instead of a manual copy-and-paste convention.
 */
export function buildReportDocumentModel(
  report: Pick<StoredReport, "provider" | "sections">,
): ReportDocumentModel {
  return {
    title: "Your private pattern atlas",
    eyebrow: `Full profile report · ${
      report.provider === "local" ? "local test adapter" : "Stripe test purchase"
    }`,
    sections: report.sections.map((section) => ({
      ...section,
      ...(section.unavailable ? { statusLabel: "Explicitly unavailable" as const } : {}),
    })),
  };
}
