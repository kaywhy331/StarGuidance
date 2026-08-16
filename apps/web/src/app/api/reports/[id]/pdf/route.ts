import { requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";
import { renderProfileReportPdf } from "@/lib/report-pdf";

export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const reportId = (await context.params).id;
    const report = await persistenceFor(user).repositories.reports.get(user.id, reportId);
    if (!report) return Response.json({ error: "Report not found." }, { status: 404 });
    if (report.status !== "ready")
      return Response.json({ error: "The report is not ready for PDF export." }, { status: 409 });
    const pdf = await renderProfileReportPdf(report);
    return new Response(new Uint8Array(pdf), {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="starguidance-profile-report-${report.id.slice(0, 8)}.pdf"`,
        "content-type": "application/pdf",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return Response.json({ error: "Authentication required." }, { status: 401 });
    return Response.json({ error: "The report PDF could not be generated." }, { status: 500 });
  }
}
