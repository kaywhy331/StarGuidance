import "server-only";

import { randomUUID } from "node:crypto";

import {
  profileSnapshotSchema,
  type ProfileSnapshot,
  type ProfileTrait,
} from "@starguidance/contracts";
import type { StoredReport, StoredReportSection } from "@starguidance/database";
import { z } from "zod";

import { persistenceFor, recordAudit } from "./persistence";
import { calculationSchema } from "./profile-engine-contract";
import { PROFILE_REPORT_SECTION_PREVIEW, type ProfileReportSectionKey } from "./report-sections";

const profileReportSourceSchema = z.object({
  snapshot: profileSnapshotSchema,
  calculation: calculationSchema,
});

export type ProfileReportSource = z.infer<typeof profileReportSourceSchema>;

export function createProfileReportSource(
  snapshot: ProfileSnapshot,
  calculationInput: unknown,
): ProfileReportSource {
  const parsedCalculation = calculationSchema.parse(calculationInput);
  return profileReportSourceSchema.parse({
    snapshot,
    calculation: {
      ...parsedCalculation,
      // name_rendering is derived from the full birth name but no report
      // section needs it. The durable background source excludes it.
      numerology: { ...parsedCalculation.numerology, name_rendering: null },
    },
  });
}

const SOURCE_LABELS: Record<ProfileTrait["sourceSystem"], string> = {
  numerology: "Pythagorean numerology",
  dreamspell: "Dreamspell",
  westernAstrology: "Western astrology",
  bazi: "BaZi",
  planetaryAngularity: "planetary angularity",
  nineStarKi: "Nine Star Ki",
};

function title(key: ProfileReportSectionKey): string {
  const section = PROFILE_REPORT_SECTION_PREVIEW.find((candidate) => candidate.key === key);
  if (!section) throw new Error("REPORT_SECTION_TITLE_MISSING");
  return section.title;
}

function section(
  key: ProfileReportSectionKey,
  body: string,
  unavailable = false,
): StoredReportSection {
  return { key, title: title(key), body, ...(unavailable ? { unavailable: true } : {}) };
}

function provenance(trait: ProfileTrait): string {
  return `${SOURCE_LABELS[trait.sourceSystem]}, ${trait.sourceRule}, ${trait.calculationVersion}; ${trait.stability}`;
}

function traitNarrative(
  snapshot: ProfileSnapshot,
  domains: readonly ProfileTrait["domain"][],
  fallback: string,
): string {
  const matches = snapshot.traits.filter((trait) => domains.includes(trait.domain));
  if (matches.length === 0) return fallback;
  return matches.map((trait) => `${trait.statement} (Source: ${provenance(trait)}.)`).join(" ");
}

function tensionNarrative(snapshot: ProfileSnapshot): string {
  if (snapshot.tensions.length === 0)
    return "No explicit cross-trait tension was produced by this snapshot. That absence is not evidence that the person has no internal contradictions.";
  return snapshot.tensions
    .map((tension) => {
      const sources = tension.traitIndexes
        .map((index) => snapshot.traits[index])
        .filter((trait): trait is ProfileTrait => Boolean(trait))
        .map((trait) => provenance(trait))
        .join("; ");
      return `${tension.sideA} At the same time, ${tension.sideB}${sources ? ` (Sources: ${sources}.)` : "."}`;
    })
    .join(" ");
}

function convergenceNarrative(snapshot: ProfileSnapshot): string {
  const byDomain = new Map<ProfileTrait["domain"], ProfileTrait[]>();
  for (const trait of snapshot.traits) {
    if (trait.stability === "unavailable") continue;
    const group = byDomain.get(trait.domain) ?? [];
    group.push(trait);
    byDomain.set(trait.domain, group);
  }
  const convergences = [...byDomain.entries()].filter(
    ([, traits]) => new Set(traits.map(({ sourceSystem }) => sourceSystem)).size > 1,
  );
  if (convergences.length === 0)
    return "This snapshot contains no same-domain agreement from two independently represented systems. StarGuidance does not manufacture convergence from unrelated traits.";
  return convergences
    .map(
      ([domain, traits]) =>
        `${domain}: ${traits.map(({ statement }) => statement).join(" / ")} (Sources: ${traits.map(provenance).join("; ")}.)`,
    )
    .join(" ");
}

function planetaryAngularityStatus(source: ProfileReportSource): string {
  switch (source.calculation.planetary_angularity.reason) {
    case "precise_birth_time_required":
      return "Planetary angular lines require a supplied birth time. Without one, StarGuidance does not invent rising, setting, culmination, or anti-culmination locations.";
    case "validated_birthplace_context_required":
      return "The birth time is present, but validated coordinates and historical timezone context are not. No city coordinate or UTC instant was guessed.";
    default:
      return "Planetary angularity mapping remains unavailable until the ephemeris license, location resolver, and independent line-reference suite are approved. No place is labeled lucky, difficult, or destined without a calculated line.";
  }
}

export function buildProfileReportSections(source: ProfileReportSource): StoredReportSection[] {
  const { calculation, snapshot } = profileReportSourceSchema.parse(source);
  const stableTraits = snapshot.traits.filter(({ stability }) => stability === "stable");
  const nineStarTraits = snapshot.traits
    .filter(({ sourceSystem }) => sourceSystem === "nineStarKi")
    .map(({ statement }) => statement)
    .join(" ");

  return [
    section(
      "overview",
      `This ${snapshot.completeness} profile is snapshot v${snapshot.version}. Its observations are deterministic, versioned, and reflective rather than diagnostic or fixed fate.`,
    ),
    section(
      "core-motivations",
      traitNarrative(
        snapshot,
        ["coreMotivation", "workStyle"],
        "No stable core-motivation trait is available in the validated systems for this snapshot.",
      ),
    ),
    section(
      "emotional-patterns",
      traitNarrative(
        snapshot,
        ["emotionalProcessing", "conflictResponse"],
        "No validated emotional-processing trait is available in this snapshot.",
      ),
    ),
    section(
      "relationships",
      traitNarrative(
        snapshot,
        ["relationshipNeeds", "socialOrientation"],
        "No validated relationship-specific trait is available in this snapshot.",
      ),
    ),
    section(
      "communication-decisions",
      traitNarrative(
        snapshot,
        ["communicationStyle", "decisionStyle"],
        "No validated communication or decision-style trait is available in this snapshot.",
      ),
    ),
    section(
      "strengths",
      stableTraits.length > 0
        ? stableTraits
            .slice(0, 6)
            .map((trait) => `${trait.statement} (Source: ${provenance(trait)}.)`)
            .join(" ")
        : "No trait is marked stable in this snapshot, so the report does not label a speculative pattern as a strength.",
    ),
    section("internal-tensions", tensionNarrative(snapshot)),
    section(
      "growth-opportunities",
      traitNarrative(
        snapshot,
        ["growthLever", "stabilityVsChange", "riskOrientation"],
        "Use the grounded integration prompts below; this snapshot does not supply a validated growth-lever trait.",
      ),
    ),
    section(
      "astrology",
      "Unavailable until ephemeris licensing, calculation conventions, and independent golden references are approved.",
      true,
    ),
    section(
      "numerology",
      calculation.numerology.name_calculation_status !== "unavailable" &&
        calculation.numerology.expression !== null &&
        calculation.numerology.soul_urge !== null &&
        calculation.numerology.personality !== null
        ? `Life Path ${calculation.numerology.life_path}; Expression ${calculation.numerology.expression}; Soul Urge ${calculation.numerology.soul_urge}; Personality ${calculation.numerology.personality}; Birthday ${calculation.numerology.birthday}. Calculated with ${calculation.numerology.algorithm_version}.`
        : `Life Path ${calculation.numerology.life_path}; Birthday ${calculation.numerology.birthday}. Name-derived values are unavailable for this writing system and were not fabricated. Calculated with ${calculation.numerology.algorithm_version}.`,
    ),
    section(
      "bazi",
      "Unavailable until boundary conventions and independent golden references receive domain-expert approval.",
      true,
    ),
    section(
      "dreamspell",
      `Kin ${calculation.dreamspell.kin}: ${calculation.dreamspell.tone_name} ${calculation.dreamspell.solar_seal_name} (${calculation.dreamspell.color}). Calculated with ${calculation.dreamspell.algorithm_version}; production certification and content-rights review remain pending.`,
    ),
    section(
      "nine-star-ki",
      `Principal ${calculation.nine_star_ki.principal_star.number} ${calculation.nine_star_ki.principal_star.phase}; Character ${calculation.nine_star_ki.character_star.number} ${calculation.nine_star_ki.character_star.phase}; derived Energy ${calculation.nine_star_ki.energy_star.number} ${calculation.nine_star_ki.energy_star.phase}. ${nineStarTraits} This uses ${calculation.nine_star_ki.algorithm_version}; independent reference review remains pending.`,
    ),
    section("planetary-angularity", planetaryAngularityStatus(source), true),
    section("cross-system-convergence", convergenceNarrative(snapshot)),
    section("cross-system-contradictions", tensionNarrative(snapshot)),
    section(
      "practical-integration",
      snapshot.tensions.length > 0
        ? "Choose one current situation where each side of a preserved tension may be useful. Name one observable sign that supports the pattern and one that would disconfirm it. Then try the smallest reversible action that honors both needs."
        : "Choose one observation that matches lived experience, name one observation that would disconfirm it, and try one small reversible action. Release any interpretation that does not become useful through observable evidence.",
    ),
  ];
}

export async function prepareProfileReportSource(input: {
  userId: string;
  snapshotId: string;
}): Promise<string> {
  const persistence = persistenceFor({ id: input.userId });
  const profile = await persistence.repositories.profileSnapshots.get(
    input.userId,
    input.snapshotId,
  );
  if (!profile) throw new Error("PROFILE_SNAPSHOT_NOT_FOUND");
  const source = createProfileReportSource(
    profile.snapshot,
    JSON.parse(persistence.decrypt(profile.encryptedCalculations, "profile-calculations")),
  );
  return persistence.encrypt(JSON.stringify(source), "report-source");
}

export function readProfileReportSource(input: {
  userId: string;
  encryptedSource: string;
}): ProfileReportSource {
  const persistence = persistenceFor({ id: input.userId });
  return profileReportSourceSchema.parse(
    JSON.parse(persistence.decrypt(input.encryptedSource, "report-source")),
  );
}

export async function generateProfileReport(input: {
  userId: string;
  snapshotId: string;
  orderId: string;
}): Promise<StoredReport> {
  const persistence = persistenceFor({ id: input.userId });
  const existing = await persistence.repositories.reports.getByOrder(input.userId, input.orderId);
  if (existing) return existing;
  const encryptedSource = await prepareProfileReportSource(input);
  const source = readProfileReportSource({ userId: input.userId, encryptedSource });
  const order = await persistence.repositories.orders.get(input.userId, input.orderId);
  if (!order) throw new Error("ORDER_NOT_FOUND");
  const report: StoredReport = {
    id: randomUUID(),
    userId: input.userId,
    snapshotId: input.snapshotId,
    orderId: input.orderId,
    provider: order.provider,
    status: "ready",
    createdAt: new Date().toISOString(),
    sections: buildProfileReportSections(source),
  };
  await persistence.repositories.reports.create(report);
  await recordAudit(input.userId, "report.generated", "report", report.id);
  return report;
}
