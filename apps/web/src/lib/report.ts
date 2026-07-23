import "server-only";

import { randomUUID } from "node:crypto";

import type { StoredReport } from "@starguidance/database";
import { persistenceFor, recordAudit } from "./persistence";
import type { ProfileCalculation } from "./profile-engine";

export async function generateProfileReport(input: {
  userId: string;
  snapshotId: string;
  orderId: string;
}): Promise<StoredReport> {
  const persistence = persistenceFor({ id: input.userId });
  const profile = await persistence.repositories.profileSnapshots.get(
    input.userId,
    input.snapshotId,
  );
  if (!profile) throw new Error("PROFILE_SNAPSHOT_NOT_FOUND");
  const calculation = JSON.parse(
    persistence.decrypt(profile.encryptedCalculations),
  ) as ProfileCalculation;
  const report: StoredReport = {
    id: randomUUID(),
    userId: input.userId,
    snapshotId: input.snapshotId,
    orderId: input.orderId,
    status: "ready",
    createdAt: new Date().toISOString(),
    sections: [
      {
        key: "overview",
        title: "Personal overview",
        body: `This ${profile.snapshot.completeness} profile is snapshot v${profile.snapshot.version}. Its observations remain reflective rather than diagnostic or fixed fate.`,
      },
      {
        key: "numerology",
        title: "Pythagorean numerology",
        body: `Life Path ${calculation.numerology.life_path}; Expression ${calculation.numerology.expression}; Soul Urge ${calculation.numerology.soul_urge}; Personality ${calculation.numerology.personality}; Birthday ${calculation.numerology.birthday}. Calculated with ${calculation.numerology.algorithm_version}.`,
      },
      {
        key: "dreamspell",
        title: "Dreamspell Galactic Signature",
        body: `Kin ${calculation.dreamspell.kin}: ${calculation.dreamspell.tone_name} ${calculation.dreamspell.solar_seal_name} (${calculation.dreamspell.color}). The implementation is deterministic, but production certification remains pending an approved reference dataset and rights review.`,
      },
      {
        key: "traits",
        title: "Recurring patterns",
        body: profile.snapshot.traits
          .filter(({ stability }) => stability === "stable")
          .map(({ statement }) => statement)
          .join(" "),
      },
      {
        key: "astrology",
        title: "Western astrology",
        body: "Unavailable until ephemeris licensing, conventions, and golden references are approved.",
        unavailable: true,
      },
      {
        key: "bazi",
        title: "BaZi Four Pillars",
        body: "Unavailable until boundary conventions and golden references receive domain-expert approval.",
        unavailable: true,
      },
      {
        key: "integration",
        title: "Practical integration",
        body:
          profile.snapshot.tensions.length > 0
            ? "Your sources preserve a tension rather than averaging it away. Experiment with when each side is useful, and judge it against observable experience."
            : "Look for repeated evidence before treating any observation as useful. Choose one grounded experiment and release what does not match lived experience.",
      },
    ],
  };
  await persistence.repositories.reports.create(report);
  await recordAudit(input.userId, "report.generated", "report", report.id);
  return report;
}
