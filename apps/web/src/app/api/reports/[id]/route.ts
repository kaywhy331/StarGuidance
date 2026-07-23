import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { localStore } from "@/lib/local-store";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const report = localStore.reports.get((await context.params).id);
    if (!report || report.userId !== user.id)
      return NextResponse.json({ error: "Report not found." }, { status: 404 });
    return NextResponse.json({ report });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
