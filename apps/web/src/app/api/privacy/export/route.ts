import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { decryptLocal, localStore, recordAudit } from "@/lib/local-store";
import { assertRateLimit } from "@/lib/request-security";

export async function GET() {
  try {
    const user = await requireUser();
    assertRateLimit(`export:${user.id}`, 3, 60 * 60 * 1000);
    recordAudit("privacy.export.created", user.id);
    return NextResponse.json(
      {
        exportedAt: new Date().toISOString(),
        account: { id: user.id, email: user.email, consentRecords: user.consentRecords },
        profiles: user.profile
          ? [...localStore.profileSnapshots.values()]
              .filter(({ snapshot }) => snapshot.profileId === user.profile?.snapshot.profileId)
              .map((profile) => ({
                snapshot: profile.snapshot,
                birthDetails: JSON.parse(decryptLocal(profile.encryptedInput)) as unknown,
                calculations: JSON.parse(decryptLocal(profile.encryptedCalculations)) as unknown,
              }))
          : [],
        readings: [...localStore.readings.values()]
          .filter(({ userId }) => userId === user.id)
          .map((reading) => ({
            id: reading.id,
            profileSnapshotId: reading.profileSnapshotId,
            spreadId: reading.spreadId,
            question: decryptLocal(reading.encryptedQuestion),
            draw: reading.draw,
            result: reading.result,
            generationStatus: reading.generationStatus,
            followUps: reading.followUps.map((followUp) => ({
              id: followUp.id,
              question: decryptLocal(followUp.encryptedQuestion),
              result: followUp.result,
            })),
            createdAt: reading.createdAt,
          })),
        reports: [...localStore.reports.values()].filter(({ userId }) => userId === user.id),
        orders: [...localStore.orders.values()].filter(({ userId }) => userId === user.id),
        entitlements: [...localStore.entitlements.values()].filter(
          ({ userId }) => userId === user.id,
        ),
        auditEvents: localStore.auditEvents.filter(({ userId }) => userId === user.id),
      },
      { headers: { "content-disposition": 'attachment; filename="starguidance-export.json"' } },
    );
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
