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
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-12">
      <p className="text-sm tracking-[.18em] text-[#d8b56d] uppercase">Private purchases</p>
      <h1 className="mt-2 text-5xl font-semibold">Profile reports</h1>
      <div className="mt-8 grid gap-4">
        {reports.length === 0 ? (
          <EmptyState title="No profile reports yet">
            Purchased reports and their preparation status will appear here.
          </EmptyState>
        ) : (
          reports.map((report) => (
            <Panel key={report.id}>
              <Link className="block" href={`/report/${report.id}`}>
                <p className="text-sm text-[#d8b56d]">
                  {report.provider === "local" ? "Local test adapter" : "Stripe test purchase"}
                </p>
                <h2 className="mt-2 text-2xl">Full profile report</h2>
                <p className="mt-2 text-sm text-[#b8adc8]">
                  {new Date(report.createdAt).toLocaleString()} · {report.status}
                </p>
              </Link>
            </Panel>
          ))
        )}
      </div>
    </main>
  );
}
