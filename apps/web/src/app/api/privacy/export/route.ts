import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { persistenceFor, recordAudit } from "@/lib/persistence";
import { assertRateLimit } from "@/lib/request-security";

export async function GET() {
  try {
    const user = await requireUser();
    assertRateLimit(`export:${user.id}`, 3, 60 * 60 * 1000);
    const persistence = persistenceFor(user);
    await recordAudit(user.id, "privacy.export.created", "account", user.id);
    const data = await persistence.repositories.privacy.export(user.id);
    return NextResponse.json(
      {
        exportedAt: new Date().toISOString(),
        account: { ...data.user, settings: data.settings, consentRecords: data.consents },
        profiles: data.profiles.map((profile) => ({
          snapshot: profile.snapshot,
          birthDetails: JSON.parse(persistence.decrypt(profile.encryptedInput)) as unknown,
          calculations: JSON.parse(persistence.decrypt(profile.encryptedCalculations)) as unknown,
        })),
        readings: data.readings.map((reading) => ({
          id: reading.id,
          profileSnapshotId: reading.profileSnapshotId,
          spreadId: reading.spreadId,
          question: persistence.decrypt(reading.encryptedQuestion),
          safetyClassification: reading.safetyClassification,
          draw: reading.draw,
          result: reading.result,
          generationStatus: reading.generationStatus,
          followUps: reading.followUps.map((followUp) => ({
            id: followUp.id,
            question: persistence.decrypt(followUp.encryptedQuestion),
            result: followUp.result,
          })),
          createdAt: reading.createdAt,
        })),
        reports: data.reports,
        orders: data.orders,
        entitlements: data.entitlements,
        auditEvents: data.auditEvents,
      },
      { headers: { "content-disposition": 'attachment; filename="starguidance-export.json"' } },
    );
  } catch {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
}
