import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { persistenceFor } from "@/lib/persistence";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const report = await persistenceFor(user).repositories.reports.get(
      user.id,
      (await context.params).id,
    );
    if (!report) return NextResponse.json({ error: "Report not found." }, { status: 404 });
    return NextResponse.json({ report });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
