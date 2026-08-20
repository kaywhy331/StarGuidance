import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { persistenceFor, recordAudit } from "@/lib/persistence";
import { assertRateLimit, requestSecurityFailure } from "@/lib/request-security";

export async function GET() {
  try {
    const user = await requireUser();
    await assertRateLimit(`export:${user.id}`, 3, 60 * 60 * 1000);
    const persistence = persistenceFor(user);
    await recordAudit(user.id, "privacy.export.created", "account", user.id);
    const data = await persistence.repositories.privacy.export(user.id);
    return NextResponse.json(
      {
        exportedAt: new Date().toISOString(),
        account: { ...data.user, settings: data.settings, consentRecords: data.consents },
        profiles: data.profiles.map((profile) => ({
          snapshot: profile.snapshot,
          birthDetails: JSON.parse(
            persistence.decrypt(profile.encryptedInput, "profile-input"),
          ) as unknown,
          calculations: JSON.parse(
            persistence.decrypt(profile.encryptedCalculations, "profile-calculations"),
          ) as unknown,
        })),
        readings: data.readings.map((reading) => ({
          id: reading.id,
          profileSnapshotId: reading.profileSnapshotId,
          spreadId: reading.spreadId,
          question: persistence.decrypt(reading.encryptedQuestion, "reading-question"),
          safetyClassification: reading.safetyClassification,
          draw: reading.draw,
          result: reading.result,
          outputProvenance: reading.outputProvenance,
          generationStatus: reading.generationStatus,
          followUps: reading.followUps.map((followUp) => ({
            id: followUp.id,
            question: persistence.decrypt(followUp.encryptedQuestion, "follow-up-question"),
            result: followUp.result,
          })),
          createdAt: reading.createdAt,
        })),
        feedback: data.feedback.map((feedback) => ({
          id: feedback.id,
          readingId: feedback.readingId,
          kind: feedback.kind,
          resonance: feedback.resonance,
          helpfulness: feedback.helpfulness,
          outcomeStatus: feedback.outcomeStatus,
          behaviorChanged: feedback.behaviorChanged,
          ...(feedback.encryptedComment
            ? {
                comment: persistence.decrypt(feedback.encryptedComment, "feedback-comment"),
              }
            : {}),
          createdAt: feedback.createdAt,
        })),
        reports: data.reports,
        orders: data.orders,
        entitlements: data.entitlements,
        auditEvents: data.auditEvents,
      },
      { headers: { "content-disposition": 'attachment; filename="starguidance-export.json"' } },
    );
  } catch (error) {
    const security = requestSecurityFailure(error);
    if (security)
      return NextResponse.json(
        { error: security.error },
        { status: security.status, headers: security.headers },
      );
    if (error instanceof Error && error.message === "UNAUTHENTICATED")
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    return NextResponse.json({ error: "The data export could not be prepared." }, { status: 500 });
  }
}
