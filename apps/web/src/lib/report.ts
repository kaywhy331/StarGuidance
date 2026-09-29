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
import {
  joinReportSectionBody,
  PROFILE_REPORT_SECTION_PREVIEW,
  type ProfileReportSectionKey,
} from "./report-sections";

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

const DOMAIN_LABELS: Record<ProfileTrait["domain"], string> = {
  coreMotivation: "What drives you",
  emotionalProcessing: "How you process feelings",
  communicationStyle: "How you communicate",
  decisionStyle: "How you decide",
  socialOrientation: "How you meet others",
  relationshipNeeds: "What you need in relationships",
  riskOrientation: "How you approach risk",
  stabilityVsChange: "Stability and change",
  conflictResponse: "How you handle conflict",
  workStyle: "How you work",
  creativeExpression: "How you create",
  repeatingTension: "A recurring tension",
  growthLever: "Where you can grow",
};

const SIGN_GISTS: Record<string, string> = {
  aries: "bold, quick to begin",
  taurus: "steady, grounded in the senses",
  gemini: "curious, quick-minded",
  cancer: "protective, emotionally attuned",
  leo: "warm, expressive, generous",
  virgo: "careful, helpful, precise",
  libra: "fair-minded, relational",
  scorpio: "intense, private, transformative",
  sagittarius: "adventurous, meaning-seeking",
  capricorn: "patient, ambitious, practical",
  aquarius: "independent, future-minded",
  pisces: "imaginative, compassionate",
};

const STEM_ELEMENTS: Record<string, string> = {
  jia: "Yang Wood",
  yi: "Yin Wood",
  bing: "Yang Fire",
  ding: "Yin Fire",
  wu: "Yang Earth",
  ji: "Yin Earth",
  geng: "Yang Metal",
  xin: "Yin Metal",
  ren: "Yang Water",
  gui: "Yin Water",
};

const BRANCH_ANIMALS: Record<string, string> = {
  zi: "Rat",
  chou: "Ox",
  yin: "Tiger",
  mao: "Rabbit",
  chen: "Dragon",
  si: "Snake",
  wu: "Horse",
  wei: "Goat",
  shen: "Monkey",
  you: "Rooster",
  xu: "Dog",
  hai: "Pig",
};

function pillarName(pillar: { heavenly_stem: string; earthly_branch: string }): string {
  return `${STEM_ELEMENTS[pillar.heavenly_stem] ?? pillar.heavenly_stem} ${BRANCH_ANIMALS[pillar.earthly_branch] ?? pillar.earthly_branch}`;
}

function systemEnabled(snapshot: ProfileSnapshot, system: ProfileTrait["sourceSystem"]): boolean {
  return snapshot.enabledSystems?.includes(system) ?? true;
}

function title(key: ProfileReportSectionKey): string {
  const section = PROFILE_REPORT_SECTION_PREVIEW.find((candidate) => candidate.key === key);
  if (!section) throw new Error("REPORT_SECTION_TITLE_MISSING");
  return section.title;
}

function section(
  key: ProfileReportSectionKey,
  meaning: string,
  technicalNote?: string,
  unavailable = false,
): StoredReportSection {
  return {
    key,
    title: title(key),
    body: joinReportSectionBody(meaning, technicalNote),
    ...(unavailable ? { unavailable: true } : {}),
  };
}

function provenance(trait: ProfileTrait): string {
  return `${SOURCE_LABELS[trait.sourceSystem]}, ${trait.sourceRule}, ${trait.calculationVersion}; ${trait.stability}`;
}

function sourcesNote(traits: readonly ProfileTrait[]): string | undefined {
  if (traits.length === 0) return undefined;
  return `Sources: ${traits.map(provenance).join("; ")}.`;
}

function displayToken(value: string): string {
  return value.replaceAll("_", " ");
}

function capitalize(value: string): string {
  return value.charAt(0).toLocaleUpperCase("en-US") + value.slice(1);
}

function traitSection(
  key: ProfileReportSectionKey,
  snapshot: ProfileSnapshot,
  domains: readonly ProfileTrait["domain"][],
  fallback: string,
): StoredReportSection {
  const matches = snapshot.traits.filter((trait) => domains.includes(trait.domain));
  if (matches.length === 0) return section(key, fallback);
  return section(key, matches.map(({ statement }) => statement).join(" "), sourcesNote(matches));
}

function tensionSection(key: ProfileReportSectionKey, snapshot: ProfileSnapshot) {
  if (snapshot.tensions.length === 0)
    return section(
      key,
      "No clear inner tug-of-war showed up in this edition. That doesn’t mean you have none — only that these calculations didn’t name one, so none is invented here.",
    );
  const traits = snapshot.tensions.flatMap((tension) =>
    tension.traitIndexes
      .map((index) => snapshot.traits[index])
      .filter((trait): trait is ProfileTrait => Boolean(trait)),
  );
  return section(
    key,
    snapshot.tensions
      .map((tension) => `${tension.sideA} At the same time, ${tension.sideB}`)
      .join(" "),
    sourcesNote(traits),
  );
}

function convergenceSection(snapshot: ProfileSnapshot): StoredReportSection {
  if (snapshot.convergences.length === 0)
    return section(
      "cross-system-convergence",
      "The traditions in this edition didn’t clearly agree on a single theme, so no agreement is invented here. Where they do meet in a future edition, it will be named.",
    );
  const notes: string[] = [];
  const meaning = snapshot.convergences
    .map((convergence) => {
      const traits = convergence.traitIndexes
        .map((index) => snapshot.traits[index])
        .filter((trait): trait is ProfileTrait => Boolean(trait));
      const observations = traits.map(({ statement }) => statement).join(" ");
      const sources = traits.map(provenance).join("; ");
      notes.push(
        `${convergence.domain}: confidence ${convergence.confidence}${sources ? `; sources: ${sources}` : ""}.`,
      );
      return `${DOMAIN_LABELS[convergence.domain]}: ${convergence.summary}${observations ? ` ${observations}` : ""}`;
    })
    .join(" ");
  return section("cross-system-convergence", meaning, notes.join(" "));
}

function unavailableNote(result: { reason: string; calculation_version: string }): string {
  return `Status: not yet available (${displayToken(result.reason)}); calculation ${result.calculation_version}.`;
}

function notInEdition(key: ProfileReportSectionKey, meaning: string, technicalNote?: string) {
  return section(key, `Not included in this edition. ${meaning}`, technicalNote, true);
}

function westernAstrologySection(source: ProfileReportSource): StoredReportSection {
  if (!systemEnabled(source.snapshot, "westernAstrology"))
    return notInEdition(
      "astrology",
      "Western astrology wasn’t part of your profile when this edition was made.",
      "System disabled for this profile snapshot.",
    );
  const result = source.calculation.western_astrology;
  if (result.status === "unavailable")
    return notInEdition(
      "astrology",
      "Your Western birth chart is still being prepared for StarGuidance. When it arrives, adding your birth time and place will unlock your rising sign and houses in a new edition.",
      unavailableNote(result),
    );

  const find = (body: string) => result.planetary_positions.find((point) => point.body === body);
  const sun = find("sun");
  const moon = find("moon");
  const describe = (label: string, sign: string | undefined) =>
    sign
      ? `${label} in ${capitalize(sign)}${SIGN_GISTS[sign] ? ` (${SIGN_GISTS[sign]})` : ""}`
      : undefined;
  const placements = [
    describe("Sun", sun?.sign),
    describe("Moon", moon?.sign),
    describe("Rising sign", result.angles.ascendant.sign),
  ].filter(Boolean);
  const placidus =
    result.house_systems.placidus.status === "available"
      ? "Placidus houses calculated."
      : `Placidus houses unavailable (${displayToken(result.house_systems.placidus.reason)}).`;
  return section(
    "astrology",
    `Your chart’s core placements: ${placements.join("; ")}. Your Sun describes where you shine, your Moon what comforts you, and your rising sign how you meet the world. Treat them as themes to notice, not a script.`,
    `${capitalize(result.zodiac)} zodiac; ${result.planetary_positions.length} planetary positions and ${result.aspects.length} aspects. Ascendant ${result.angles.ascendant.longitude_degrees.toFixed(2)}°; Midheaven ${result.angles.midheaven.longitude_degrees.toFixed(2)}°. Whole Sign houses calculated. ${placidus} Calculation ${result.calculation_version}; ${result.uncertainty.status}.`,
  );
}

function baziSection(source: ProfileReportSource): StoredReportSection {
  if (!systemEnabled(source.snapshot, "bazi"))
    return notInEdition(
      "bazi",
      "BaZi wasn’t part of your profile when this edition was made.",
      "System disabled for this profile snapshot.",
    );
  const result = source.calculation.bazi;
  if (result.status === "unavailable")
    return notInEdition(
      "bazi",
      "BaZi (the Chinese Four Pillars of Destiny) is still being prepared for StarGuidance. When it arrives, your birth time and place will let it read all four pillars in a new edition.",
      unavailableNote(result),
    );

  const pillars = Object.entries(result.pillars)
    .map(([name, pillar]) => `${name} ${pillarName(pillar)}`)
    .join("; ");
  const stems = Object.entries(result.pillars)
    .map(
      ([name, pillar]) =>
        `${name} ${displayToken(pillar.heavenly_stem)}-${displayToken(pillar.earthly_branch)}`,
    )
    .join("; ");
  return section(
    "bazi",
    `Your four pillars — ${pillars}. Each pillar pairs an element with an animal sign, describing a layer of your life from outward circumstances (year) to your inner nature (day).`,
    `${stems}. Year boundary ${displayToken(result.conventions.year_boundary)}; month boundary ${displayToken(result.conventions.month_boundary)}; true solar time ${displayToken(result.conventions.true_solar_time)}; Zi-hour day boundary ${result.conventions.zi_hour_day_boundary}. Calculation ${result.calculation_version}; ${result.uncertainty.status}.`,
  );
}

function planetaryAngularitySection(source: ProfileReportSource): StoredReportSection {
  if (!systemEnabled(source.snapshot, "planetaryAngularity"))
    return notInEdition(
      "planetary-angularity",
      "Location lines weren’t part of your profile when this edition was made.",
      "System disabled for this profile snapshot.",
    );
  const result = source.calculation.planetary_angularity;
  if (result.status === "available")
    return section(
      "planetary-angularity",
      `Your birth moment draws ${result.lines.length} lines across the world map — places where a planet was rising, setting, or overhead as you were born. They describe geometry, not luck: no place is marked lucky, difficult, or destined.`,
      `WGS84 calculation; ${result.lines.length} angular lines and ${result.crossings.length} recorded crossings under interpretation policy ${result.interpretation_policy_version}. Calculation ${result.calculation_version}; ${result.uncertainty.status}.`,
    );

  let meaning: string;
  switch (result.reason) {
    case "precise_birth_time_required":
      meaning =
        "Add your birth time to unlock where your planets were rising and setting around the world. Without it, no location is guessed.";
      break;
    case "validated_birthplace_context_required":
      meaning =
        "Add a birthplace we can place on the map to unlock your location lines. No city or time zone was guessed.";
      break;
    default:
      meaning =
        "Location lines are still being prepared for StarGuidance. When they arrive, your birth time and place will unlock them in a new edition. No place is labeled lucky or difficult in the meantime.";
  }
  return notInEdition("planetary-angularity", meaning, unavailableNote(result));
}

function lifePathStatement(traits: readonly ProfileTrait[]): string | undefined {
  const motivations = traits.filter(
    ({ domain, sourceSystem }) => sourceSystem === "numerology" && domain === "coreMotivation",
  );
  return (
    motivations.find(({ sourceRule }) => sourceRule.startsWith("pythagorean.life_path.")) ??
    motivations[0]
  )?.statement;
}

function numerologySection(source: ProfileReportSource): StoredReportSection {
  const { calculation, snapshot } = source;
  if (!systemEnabled(snapshot, "numerology"))
    return notInEdition(
      "numerology",
      "Numerology wasn’t part of your profile when this edition was made.",
      "System disabled for this profile snapshot.",
    );
  const numerology = calculation.numerology;
  const traits = snapshot.traits.filter(({ sourceSystem }) => sourceSystem === "numerology");
  const lifePathMeaning = lifePathStatement(traits);
  const nameNumbers =
    numerology.name_calculation_status !== "unavailable" &&
    numerology.expression !== null &&
    numerology.soul_urge !== null &&
    numerology.personality !== null
      ? ` From your birth name: Expression ${numerology.expression} (how you express yourself), Soul Urge ${numerology.soul_urge} (what you long for), and Personality ${numerology.personality} (how others first see you).`
      : " Name-based numbers aren’t available for the way your name is written, so none were made up.";
  return section(
    "numerology",
    `Your Life Path number is ${numerology.life_path} and your Birthday number is ${numerology.birthday}.${lifePathMeaning ? ` ${lifePathMeaning}` : ""}${nameNumbers}`,
    [`Calculated with ${numerology.algorithm_version}.`, sourcesNote(traits)]
      .filter(Boolean)
      .join(" "),
  );
}

function dreamspellSection(source: ProfileReportSource): StoredReportSection {
  const { calculation, snapshot } = source;
  if (!systemEnabled(snapshot, "dreamspell"))
    return notInEdition(
      "dreamspell",
      "Dreamspell wasn’t part of your profile when this edition was made.",
      "System disabled for this profile snapshot.",
    );
  const dreamspell = calculation.dreamspell;
  const traits = snapshot.traits.filter(({ sourceSystem }) => sourceSystem === "dreamspell");
  return section(
    "dreamspell",
    `Your Galactic Signature is Kin ${dreamspell.kin}: the ${dreamspell.color} ${dreamspell.tone_name} ${dreamspell.solar_seal_name}. ${traits.map(({ statement }) => statement).join(" ")}`.trim(),
    `Calculated with ${dreamspell.algorithm_version}; production certification and content-rights review remain pending.${traits.length ? ` ${sourcesNote(traits)}` : ""}`,
  );
}

function nineStarKiSection(source: ProfileReportSource): StoredReportSection {
  const { calculation, snapshot } = source;
  if (!systemEnabled(snapshot, "nineStarKi"))
    return notInEdition(
      "nine-star-ki",
      "Nine Star Ki wasn’t part of your profile when this edition was made.",
      "System disabled for this profile snapshot.",
    );
  const stars = calculation.nine_star_ki;
  const traits = snapshot.traits.filter(({ sourceSystem }) => sourceSystem === "nineStarKi");
  const star = (value: { number: number; phase: string }) =>
    `${value.number} ${capitalize(value.phase)}`;
  return section(
    "nine-star-ki",
    `Your principal star is ${star(stars.principal_star)}, your character star ${star(stars.character_star)}, and your energy star ${star(stars.energy_star)}. ${traits.map(({ statement }) => statement).join(" ")}`.trim(),
    `Calculated with ${stars.algorithm_version}; boundary ${displayToken(stars.boundary_convention)}; third star ${displayToken(stars.third_star_convention)}; independent reference review remains pending.${traits.length ? ` ${sourcesNote(traits)}` : ""}`,
  );
}

export function buildProfileReportSections(source: ProfileReportSource): StoredReportSection[] {
  const parsed = profileReportSourceSchema.parse(source);
  const { snapshot } = parsed;
  const stableTraits = snapshot.traits.filter(({ stability }) => stability === "stable");
  const depth =
    snapshot.completeness === "complete"
      ? "It draws on your birth name, date, time, and place."
      : snapshot.completeness === "locationEnhanced"
        ? "It draws on your birth name, date, and place. Adding your birth time would open more chapters."
        : "It draws on your birth name and date. Adding your birth time and place would open more chapters.";

  return [
    section(
      "overview",
      `This atlas gathers what your birth details suggest across several traditions. ${depth} Read it as a mirror for reflection — patterns to test against your own life, never a diagnosis or a fixed fate.`,
      `Profile snapshot v${snapshot.version} (${snapshot.completeness}); every observation comes from fixed, versioned calculations.`,
    ),
    traitSection(
      "core-motivations",
      snapshot,
      ["coreMotivation", "workStyle"],
      "Nothing in this edition speaks clearly to what drives you yet, so nothing is guessed.",
    ),
    traitSection(
      "emotional-patterns",
      snapshot,
      ["emotionalProcessing", "conflictResponse"],
      "Nothing in this edition speaks clearly to how you process feelings yet, so nothing is guessed.",
    ),
    traitSection(
      "relationships",
      snapshot,
      ["relationshipNeeds", "socialOrientation"],
      "Nothing in this edition speaks clearly to your relationships yet, so nothing is guessed.",
    ),
    traitSection(
      "communication-decisions",
      snapshot,
      ["communicationStyle", "decisionStyle"],
      "Nothing in this edition speaks clearly to how you communicate or decide yet, so nothing is guessed.",
    ),
    stableTraits.length > 0
      ? section(
          "strengths",
          stableTraits
            .slice(0, 6)
            .map(({ statement }) => statement)
            .join(" "),
          sourcesNote(stableTraits.slice(0, 6)),
        )
      : section(
          "strengths",
          "None of the patterns in this edition are steady enough to call a strength, so none is claimed.",
        ),
    tensionSection("internal-tensions", snapshot),
    traitSection(
      "growth-opportunities",
      snapshot,
      ["growthLever", "stabilityVsChange", "riskOrientation"],
      "This edition doesn’t name a specific growth edge. The practical prompts at the end are a good place to start.",
    ),
    westernAstrologySection(parsed),
    numerologySection(parsed),
    baziSection(parsed),
    dreamspellSection(parsed),
    nineStarKiSection(parsed),
    planetaryAngularitySection(parsed),
    convergenceSection(snapshot),
    tensionSection("cross-system-contradictions", snapshot),
    section(
      "practical-integration",
      snapshot.tensions.length > 0
        ? "Choose one current situation where each side of a tension above might be useful. Name one sign that supports the pattern and one that would contradict it. Then try the smallest step you could easily undo that honors both needs."
        : "Choose one observation that matches your lived experience, name one sign that would contradict it, and try one small step you could easily undo. Let go of anything that doesn’t prove useful in real life.",
    ),
  ];
}

export interface ProfileHighlight {
  key: "life-path" | "sun-sign" | "nine-star-ki" | "dreamspell" | "bazi-year";
  symbol: string;
  label: string;
  value: string;
  meaning: string;
}

/**
 * A few plain-language highlights for the profile page, drawn only from
 * systems that are enabled for the snapshot and calculated as available —
 * the same facts the full atlas shows, never an invented interpretation.
 */
export function buildProfileHighlights(
  snapshot: ProfileSnapshot,
  calculationInput: unknown,
): ProfileHighlight[] {
  const calculation = calculationSchema.parse(calculationInput);
  const highlights: ProfileHighlight[] = [];
  const traitFor = (system: ProfileTrait["sourceSystem"], domain?: ProfileTrait["domain"]) =>
    snapshot.traits.find(
      (trait) => trait.sourceSystem === system && (!domain || trait.domain === domain),
    )?.statement;

  if (systemEnabled(snapshot, "numerology"))
    highlights.push({
      key: "life-path",
      symbol: String(calculation.numerology.life_path),
      label: "Life Path",
      value: `Number ${calculation.numerology.life_path}`,
      meaning:
        lifePathStatement(snapshot.traits) ??
        "The number your birth date reduces to — the long arc of your life’s lessons.",
    });
  const western = calculation.western_astrology;
  if (systemEnabled(snapshot, "westernAstrology") && western.status === "available") {
    const sun = western.planetary_positions.find(({ body }) => body === "sun");
    if (sun)
      highlights.push({
        key: "sun-sign",
        symbol: "☉",
        label: "Sun sign",
        value: capitalize(sun.sign),
        meaning: `Where you shine: ${SIGN_GISTS[sun.sign] ?? "your core self"}.`,
      });
  }
  const bazi = calculation.bazi;
  if (systemEnabled(snapshot, "bazi") && bazi.status === "available") {
    highlights.push({
      key: "bazi-year",
      symbol: "☯",
      label: "Chinese zodiac",
      value: pillarName(bazi.pillars.year),
      meaning: "The element and animal of your birth year — how you tend to meet the wider world.",
    });
  }
  if (systemEnabled(snapshot, "nineStarKi")) {
    const principal = calculation.nine_star_ki.principal_star;
    highlights.push({
      key: "nine-star-ki",
      symbol: "✶",
      label: "Nine Star Ki",
      value: `${principal.number} ${capitalize(principal.phase)} star`,
      meaning:
        traitFor("nineStarKi", "coreMotivation") ??
        "Your principal star in the Japanese nine-star tradition.",
    });
  }
  if (systemEnabled(snapshot, "dreamspell")) {
    const dreamspell = calculation.dreamspell;
    highlights.push({
      key: "dreamspell",
      symbol: "◎",
      label: "Galactic Signature",
      value: `Kin ${dreamspell.kin} · ${dreamspell.color} ${dreamspell.tone_name} ${dreamspell.solar_seal_name}`,
      meaning:
        traitFor("dreamspell") ?? "Your day sign in the Dreamspell calendar's 260-day cycle.",
    });
  }
  return highlights;
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
