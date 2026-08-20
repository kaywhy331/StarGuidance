import Link from "next/link";
import { redirect } from "next/navigation";
import { EmptyState, Panel } from "@starguidance/design-system";

import { requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";

export default async function ReportsPage() {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    redirect("/sign-in");
  }
  if (user.requiresPolicyReconsent) redirect("/consent");
  const reports = await persistenceFor(user).repositories.reports.list(user.id);
  return (
    <main className="report-library-shell">
      <header className="report-library-header">
        <div>
          <p className="page-eyebrow">Private purchases · deterministic snapshots</p>
          <h1>Your pattern atlases</h1>
          <p>
            Each report belongs to one protected profile snapshot. Unavailable calculations remain
            visibly marked instead of being inferred or invented.
          </p>
        </div>
        <Link href="/profile">Return to private profile</Link>
      </header>
      <section aria-label="Profile reports" className="report-library-grid">
        {reports.length === 0 ? (
          <EmptyState title="No profile reports yet">
            <p>Purchased reports and their preparation status will appear here.</p>
            <Link href="/profile">Preview your full pattern atlas</Link>
          </EmptyState>
        ) : (
          reports.map((report, index) => (
            <Panel className="report-library-volume" key={report.id}>
              <Link href={`/report/${report.id}`}>
                <span aria-hidden="true" className="report-library-volume-mark">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <p>
                    {report.provider === "local" ? "Local test adapter" : "Stripe test purchase"}
                  </p>
                  <h2>Full profile report</h2>
                  <time dateTime={report.createdAt}>
                    {new Date(report.createdAt).toLocaleString()}
                  </time>
                </div>
                <strong data-status={report.status}>{report.status}</strong>
                <span>Open atlas →</span>
              </Link>
            </Panel>
          ))
        )}
      </section>
    </main>
  );
}
