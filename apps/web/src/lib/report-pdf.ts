import "server-only";

import PDFDocument from "pdfkit";
import type { StoredReport } from "@starguidance/database";

import { buildReportDocumentModel } from "./report-document";

/** Generates a tagged, language-declared PDF from the same structured model as the web report. */
export async function renderProfileReportPdf(report: StoredReport): Promise<Buffer> {
  const model = buildReportDocumentModel(report);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const createdAt = new Date(report.createdAt);
    const document = new PDFDocument({
      autoFirstPage: true,
      compress: false,
      displayTitle: true,
      info: {
        Title: model.title,
        Author: "StarGuidance",
        Subject: "Private structured profile report",
        CreationDate: createdAt,
        ModDate: createdAt,
      },
      lang: "en-US",
      margins: { top: 54, right: 54, bottom: 54, left: 54 },
      pdfVersion: "1.7",
      tagged: true,
    });
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(chunks)));

    const root = document.struct("Document", { lang: "en-US", title: model.title });
    document.addStructure(root);
    document
      .font("Helvetica")
      .fontSize(10)
      .fillColor("#5d5266")
      .text(model.eyebrow, { structParent: root, structType: "P" });
    document
      .moveDown(0.5)
      .font("Helvetica-Bold")
      .fontSize(24)
      .fillColor("#201827")
      .text(model.title, { structParent: root, structType: "H1" });
    document.moveDown(1);

    for (const section of model.sections) {
      if (document.y > document.page.height - 150) document.addPage();
      document
        .font("Helvetica-Bold")
        .fontSize(16)
        .fillColor("#201827")
        .text(section.title, { structParent: root, structType: "H2" });
      if (section.statusLabel)
        document
          .moveDown(0.25)
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor("#6d4c20")
          .text(section.statusLabel, { structParent: root, structType: "P" });
      document
        .moveDown(0.35)
        .font("Helvetica")
        .fontSize(11)
        .fillColor("#201827")
        .text(section.body, {
          align: "left",
          lineGap: 3,
          structParent: root,
          structType: "P",
        });
      document.moveDown(1);
    }

    root.end();
    document.end();
  });
}
