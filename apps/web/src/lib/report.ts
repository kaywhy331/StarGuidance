import "server-only";

import { randomUUID } from "node:crypto";

import type { StoredReport } from "@starguidance/database";
import { persistenceFor, recordAudit } from "./persistence";
import type { ProfileCalculation } from "./profile-engine";

function planetaryAngularityStatus(calculation: ProfileCalculation): string {
  switch (calculation.planetary_angularity.reason) {
    case "precise_birth_time_required":
      return "Planetary angular lines require a supplied birth time. Without one, StarGuidance does not invent rising, setting, culmination, or anti-culmination locations.";
    case "validated_birthplace_context_required":
      return "The birth time is present, but validated coordinates and historical timezone context are not. No city coordinate or UTC instant was guessed.";
    default:
      return "Planetary angularity mapping remains unavailable until the ephemeris license, location resolver, and independent line-reference suite are approved. No place is labeled lucky, difficult, or destined without a calculated line.";
  }
}

export async function generateProfileReport(input: {
  userId: string;
  snapshotId: string;
  orderId: string;
}): Promise<StoredReport> {
  const persistence = persistenceFor({ id: input.userId });
  const existing = await persistence.repositories.reports.getByOrder(input.userId, input.orderId);
  if (existing) return existing;
  const profile = await persistence.repositories.profileSnapshots.get(
    input.userId,
    input.snapshotId,
  );
  if (!profile) throw new Error("PROFILE_SNAPSHOT_NOT_FOUND");
  const calculation = JSON.parse(
    persistence.decrypt(profile.encryptedCalculations, "profile-calculations"),
  ) as ProfileCalculation;
  const nineStarTraits = profile.snapshot.traits
    .filter(({ sourceSystem }) => sourceSystem === "nineStarKi")
    .map(({ statement }) => statement)
    .join(" ");
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
        body:
          calculation.numerology.name_calculation_status !== "unavailable" &&
          calculation.numerology.expression !== null &&
          calculation.numerology.soul_urge !== null &&
          calculation.numerology.personality !== null
            ? `Life Path ${calculation.numerology.life_path}; Expression ${calculation.numerology.expression}; Soul Urge ${calculation.numerology.soul_urge}; Personality ${calculation.numerology.personality}; Birthday ${calculation.numerology.birthday}. Calculated with ${calculation.numerology.algorithm_version}.`
            : `Life Path ${calculation.numerology.life_path}; Birthday ${calculation.numerology.birthday}. Name-derived Pythagorean values are unavailable for this writing system and were not fabricated. Calculated with ${calculation.numerology.algorithm_version}.`,
      },
      {
        key: "dreamspell",
        title: "Dreamspell Galactic Signature",
        body: `Kin ${calculation.dreamspell.kin}: ${calculation.dreamspell.tone_name} ${calculation.dreamspell.solar_seal_name} (${calculation.dreamspell.color}). The implementation is deterministic, but production certification remains pending an approved reference dataset and rights review.`,
      },
      {
        key: "nine-star-ki",
        title: "Nine Star Ki",
        body: `Principal ${calculation.nine_star_ki.principal_star.number} ${calculation.nine_star_ki.principal_star.phase}; Character ${calculation.nine_star_ki.character_star.number} ${calculation.nine_star_ki.character_star.phase}; derived Energy ${calculation.nine_star_ki.energy_star.number} ${calculation.nine_star_ki.energy_star.phase}. ${nineStarTraits} This uses the named fixed civil-date and Lo Shu-derived third-star conventions in ${calculation.nine_star_ki.algorithm_version}; it does not claim minute-level astronomical precision, and independent reference review remains pending.`,
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
        key: "planetary-angularity",
        title: "Planetary angularity and location",
        body: planetaryAngularityStatus(calculation),
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
