import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, Panel } from "@starguidance/design-system";

import { requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";
import { formatReportEditionDate } from "@/lib/report-document";

const REPORT_STATUS = {
  pending: { icon: "◌", label: "Being prepared" },
  ready: { icon: "✦", label: "Ready to read" },
  failed: { icon: "↻", label: "Needs a retry" },
} as const;

export const metadata: Metadata = { title: "Reports" };

export default async function ReportsPage() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    redirect("/sign-in?next=%2Freports");
  }
  if (user.requiresPolicyReconsent) redirect("/consent");
  const reports = await persistenceFor(user).repositories.reports.list(user.id);
  return (
    <main className="report-library-shell">
      <header className="report-library-header">
        <div>
          <p className="page-eyebrow">Your purchases</p>
          <h1>Your pattern atlases</h1>
          <p>
            Each atlas is written from your birth details as they were on the day you bought it, and
            it stays exactly as written. If you update your details later, you can get a new
            edition.
          </p>
        </div>
        <Link href="/profile">← Your profile</Link>
      </header>
      <section aria-label="Your pattern atlases" className="report-library-grid">
        {reports.length === 0 ? (
          <EmptyState title="No pattern atlases yet">
            <p>
              A pattern atlas is a one-time purchase: a long-form reading of your whole profile.
              Once you buy one, it will appear here.
            </p>
            <Link href="/profile">See what’s inside your atlas</Link>
          </EmptyState>
        ) : (
          reports.map((report, index) => {
            const status = REPORT_STATUS[report.status];
            const date = formatReportEditionDate(report.createdAt);
            return (
              <Panel className="report-library-volume" key={report.id}>
                <Link href={`/report/${report.id}`}>
                  <span aria-hidden="true" className="report-library-volume-mark">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h2>Pattern atlas · {date}</h2>
                    <time dateTime={report.createdAt}>Purchased {date}</time>
                  </div>
                  <strong data-status={report.status}>
                    <span aria-hidden="true">{status.icon}</span> {status.label}
                  </strong>
                  <span>{report.status === "ready" ? "Open atlas →" : "View status →"}</span>
                </Link>
              </Panel>
            );
          })
        )}
      </section>
    </main>
  );
}
