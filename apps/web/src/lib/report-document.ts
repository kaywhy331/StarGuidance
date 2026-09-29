import type { StoredReport, StoredReportSection } from "@starguidance/database";

import { splitReportSectionBody } from "./report-sections";

export interface ReportDocumentSection extends StoredReportSection {
  /** The plain-language part of the stored body, shown first. */
  meaning: string;
  /** Calculation details, shown collapsed on the web and as a footnote in the PDF. */
  technicalNote?: string;
  statusLabel?: "Not in this edition";
}

export interface ReportDocumentModel {
  title: string;
  eyebrow: string;
  sections: ReportDocumentSection[];
}

const editionDate = new Intl.DateTimeFormat("en-US", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function formatReportEditionDate(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? "" : editionDate.format(date);
}

/**
 * The only presentation model for both web and PDF report output. Keeping the
 * eyebrow, the meaning/technical-note split, and unavailable-state labelling
 * here makes content parity a structural property instead of a manual
 * copy-and-paste convention. Payment provider details are never shown: they
 * mean nothing to the reader.
 */
export function buildReportDocumentModel(
  report: Pick<StoredReport, "sections"> & Partial<Pick<StoredReport, "createdAt" | "provider">>,
): ReportDocumentModel {
  const purchased = report.createdAt ? formatReportEditionDate(report.createdAt) : "";
  return {
    title: "Your private pattern atlas",
    eyebrow: purchased ? `Pattern atlas · Purchased ${purchased}` : "Pattern atlas",
    sections: report.sections.map((section) => {
      const { meaning, technicalNote } = splitReportSectionBody(section.body);
      return {
        ...section,
        meaning,
        ...(technicalNote ? { technicalNote } : {}),
        ...(section.unavailable ? { statusLabel: "Not in this edition" as const } : {}),
      };
    }),
  };
}
