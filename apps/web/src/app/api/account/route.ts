import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, requireUser } from "@/lib/auth";
import { localStore, recordAudit } from "@/lib/local-store";
import { assertSameOrigin } from "@/lib/request-security";

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    localStore.auditEvents = localStore.auditEvents.filter(({ userId }) => userId !== user.id);
    for (const [id, reading] of localStore.readings)
      if (reading.userId === user.id) localStore.readings.delete(id);
    for (const [id, report] of localStore.reports)
      if (report.userId === user.id) localStore.reports.delete(id);
    for (const [id, order] of localStore.orders)
      if (order.userId === user.id) localStore.orders.delete(id);
    for (const [id, entitlement] of localStore.entitlements)
      if (entitlement.userId === user.id) localStore.entitlements.delete(id);
    for (const [id, profile] of localStore.profileSnapshots)
      if (profile.snapshot.profileId === user.profile?.snapshot.profileId)
        localStore.profileSnapshots.delete(id);
    for (const [token, userId] of localStore.sessions)
      if (userId === user.id) localStore.sessions.delete(token);
    for (const key of localStore.idempotency.keys())
      if (key.startsWith(`${user.id}:`)) localStore.idempotency.delete(key);
    localStore.users.delete(user.id);
    localStore.usersByEmail.delete(user.email);
    recordAudit("account.deleted", "deleted");
    const jar = await cookies();
    jar.delete(SESSION_COOKIE);
    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
