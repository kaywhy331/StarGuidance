"use client";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, LoadingState, Panel } from "@starguidance/design-system";
import { buildReportDocumentModel } from "@/lib/report-document";
import { emitBrowserProductEventOnce } from "@/lib/product-telemetry-client";
interface Report {
  id: string;
  provider: "local" | "stripe";
  status: "pending" | "ready" | "failed";
  sections: { key: string; title: string; body: string; unavailable?: boolean }[];
}
export function ReportView({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState<string>();
  const router = useRouter();
  const loadReport = useCallback(async () => {
    const response = await fetch(`/api/reports/${reportId}`, { cache: "no-store" });
    if (response.status === 401) return router.push("/sign-in");
    if (!response.ok) return setError("This report is unavailable.");
    const payload = (await response.json()) as { report: Report };
    setReport(payload.report);
    setError(undefined);
  }, [reportId, router]);
  useEffect(() => {
    const timer = setTimeout(() => void loadReport(), 0);
    return () => clearTimeout(timer);
  }, [loadReport]);
  useEffect(() => {
    if (report?.status !== "pending") return;
    const timer = setInterval(() => void loadReport(), 2_000);
    return () => clearInterval(timer);
  }, [loadReport, report?.status]);
  useEffect(() => {
    if (report?.status !== "ready") return;
    emitBrowserProductEventOnce("report_viewed", `report:${reportId}`, {
      routeClass: "report",
      statusClass: "ready",
    });
  }, [report?.status, reportId]);
  if (error)
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Panel>
          <h1 className="text-3xl">Report unavailable</h1>
          <p className="mt-3">{error}</p>
        </Panel>
      </main>
    );
  if (!report)
    return (
      <main className="grid min-h-screen place-items-center">
        <LoadingState label="Preparing your report…" />
      </main>
    );
  if (report.status === "pending")
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Panel>
          <p className="text-sm tracking-[.2em] text-[#d8b56d] uppercase">Payment confirmed</p>
          <h1 className="mt-3 text-3xl">Your report is being prepared</h1>
          <p className="mt-3 text-[#b8adc8]">
            The purchase is retained while a background job builds the deterministic report. This
            page checks automatically; leaving it will not cancel fulfillment.
          </p>
          <div className="mt-6">
            <LoadingState label="Preparing your report…" />
          </div>
        </Panel>
      </main>
    );
  if (report.status === "failed")
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <Panel>
          <h1 className="text-3xl">Report preparation paused</h1>
          <p className="mt-3 text-[#b8adc8]">
            Your purchase and locked report source are retained. Retry preparation without another
            charge.
          </p>
          <Button
            className="mt-5"
            onClick={async () => {
              const response = await fetch(`/api/reports/${reportId}`, { method: "POST" });
              const payload = (await response.json()) as {
                reportStatus?: Report["status"];
                error?: string;
              };
              if (!response.ok) return setError(payload.error ?? "Retry could not be scheduled.");
              setReport((current) =>
                current ? { ...current, status: payload.reportStatus ?? "pending" } : current,
              );
            }}
          >
            Retry report preparation
          </Button>
        </Panel>
      </main>
    );
  const document = buildReportDocumentModel(report);
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 print:max-w-none print:text-black">
      <p className="text-sm tracking-[.2em] text-[#d8b56d] uppercase">{document.eyebrow}</p>
      <h1 className="mt-3 text-5xl font-semibold">{document.title}</h1>
      <div className="mt-5 flex flex-wrap gap-3 print:hidden">
        <Button onClick={() => window.print()}>Print</Button>
        <a
          className="min-h-11 rounded-full bg-[#f5efe1] px-5 py-2 font-semibold text-[#171121]"
          download
          href={`/api/reports/${reportId}/pdf`}
        >
          Download accessible PDF
        </a>
      </div>
      <div className="mt-8 grid gap-5">
        {document.sections.map((section) => (
          <Panel
            className={section.unavailable ? "border-dashed opacity-75" : ""}
            key={section.key}
          >
            <h2 className="text-2xl">{section.title}</h2>
            {section.statusLabel && (
              <p className="mt-2 text-sm text-[#d8b56d]">{section.statusLabel}</p>
            )}
            <p className="mt-3 leading-7">{section.body}</p>
          </Panel>
        ))}
      </div>
    </main>
  );
}
