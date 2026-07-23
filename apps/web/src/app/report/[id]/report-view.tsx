"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingState, Panel } from "@starguidance/design-system";
interface Report {
  id: string;
  status: string;
  sections: { key: string; title: string; body: string; unavailable?: boolean }[];
}
export function ReportView({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState<string>();
  const router = useRouter();
  useEffect(() => {
    void fetch(`/api/reports/${reportId}`, { cache: "no-store" }).then(async (response) => {
      if (response.status === 401) return router.push("/sign-in");
      if (!response.ok) return setError("This report is unavailable.");
      const payload = (await response.json()) as { report: Report };
      setReport(payload.report);
    });
  }, [reportId, router]);
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
  return (
    <main className="mx-auto max-w-4xl px-6 py-12 print:max-w-none print:text-black">
      <p className="text-sm tracking-[.2em] text-[#d8b56d] uppercase">
        Full profile report · local test entitlement
      </p>
      <h1 className="mt-3 text-5xl font-semibold">Your private profile</h1>
      <div className="mt-8 grid gap-5">
        {report.sections.map((section) => (
          <Panel
            className={section.unavailable ? "border-dashed opacity-75" : ""}
            key={section.key}
          >
            <h2 className="text-2xl">{section.title}</h2>
            {section.unavailable && (
              <p className="mt-2 text-sm text-[#d8b56d]">Explicitly unavailable</p>
            )}
            <p className="mt-3 leading-7">{section.body}</p>
          </Panel>
        ))}
      </div>
    </main>
  );
}
