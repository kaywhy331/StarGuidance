import { NextResponse } from "next/server";
import { actorTransaction, reenqueueReportJob } from "@starguidance/database";
import { requireUser } from "@/lib/auth";
import { persistenceFor, recordAudit } from "@/lib/persistence";
import { assertRateLimit, assertSameOrigin, requestSecurityFailure } from "@/lib/request-security";
import { getRuntimeAdapter, getSystemDatabaseClient } from "@/lib/runtime";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const report = await persistenceFor(user).repositories.reports.get(
      user.id,
      (await context.params).id,
    );
    if (!report)
      return NextResponse.json(
        { error: "We couldn’t find this atlas in your account." },
        { status: 404 },
      );
    return NextResponse.json({ report });
  } catch (error) {
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json(
      { error: "Your atlas couldn’t be opened just now. Please try again in a moment." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    await assertRateLimit(`report-retry:${user.id}`, 6, 60 * 60 * 1000);
    const reportId = (await context.params).id;
    const report = await persistenceFor(user).repositories.reports.get(user.id, reportId);
    if (!report)
      return NextResponse.json(
        { error: "We couldn’t find this atlas in your account." },
        { status: 404 },
      );
    if (report.status !== "failed")
      return NextResponse.json({ reportStatus: report.status }, { status: 200 });
    if (getRuntimeAdapter() !== "supabase")
      return NextResponse.json(
        {
          error:
            "This atlas can’t be restarted automatically here. Please contact support and we’ll finish it for you — you won’t be charged again.",
        },
        { status: 409 },
      );
    const requeued = await actorTransaction(getSystemDatabaseClient(), user.id, (tx) =>
      reenqueueReportJob(tx, reportId),
    );
    if (!requeued)
      return NextResponse.json(
        {
          error:
            "This atlas can’t be restarted automatically. Please contact support and we’ll finish it for you — you won’t be charged again.",
        },
        { status: 409 },
      );
    await recordAudit(user.id, "report.generation.retried", "report", reportId);
    return NextResponse.json({ reportStatus: "pending" });
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json(
      { error: "We couldn’t restart preparation just now. Please try again in a moment." },
      { status: 500 },
    );
  }
}
