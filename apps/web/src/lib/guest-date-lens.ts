import "server-only";

import { selectReadingLens } from "@starguidance/ai";
import type { ProfileTrait, QuestionClassification } from "@starguidance/contracts";

import { calculateProfile } from "./profile-engine";

// The profile engine deliberately treats this symbol as an unsupported name,
// leaving every name-derived numerology field unavailable. It lets the guest
// lane reuse the deployed, versioned date calculations without inventing or
// requesting a birth name.
const DATE_ONLY_NAME_SENTINEL = "∅";
const DATE_ONLY_NUMEROLOGY_RULES = ["pythagorean.life_path.", "pythagorean.birthday."];

function stableDateTraits(traits: readonly ProfileTrait[]): readonly ProfileTrait[] {
  return traits.filter(
    (trait) =>
      trait.sourceSystem === "numerology" &&
      trait.stability === "stable" &&
      DATE_ONLY_NUMEROLOGY_RULES.some((prefix) => trait.sourceRule.startsWith(prefix)),
  );
}

/**
 * Produces a compact, question-relevant lens from a birthday without retaining
 * the raw date or allowing it to enter the tarot draw. Dreamspell and Nine Star
 * Ki remain excluded here while their editorial certifications are pending.
 */
export async function guestDateLensStatements(
  birthDate: string,
  question: string,
  classification: QuestionClassification,
): Promise<readonly string[]> {
  try {
    const calculation = await calculateProfile({
      fullBirthName: DATE_ONLY_NAME_SENTINEL,
      birthDate,
    });
    if (
      calculation.numerology.name_calculation_status !== "unavailable" ||
      calculation.numerology.name_rendering !== null
    )
      throw new Error("DATE_ONLY_NAME_DERIVATION_ENABLED");

    const traits = stableDateTraits(calculation.mappedTraits);
    const selected = selectReadingLens(question, traits, [], classification.topic).statements;
    if (selected.length > 0) return selected;

    // Date-only numerology has no relationship-specific rule. Keep those
    // questions personalized with the stable core-motivation observation
    // rather than substituting a fabricated relationship trait.
    const fallback = traits.find(({ domain }) => domain === "coreMotivation") ?? traits[0];
    if (!fallback) throw new Error("DATE_ONLY_TRAITS_UNAVAILABLE");
    return [fallback.statement];
  } catch {
    throw new Error("GUEST_DATE_LENS_UNAVAILABLE");
  }
}
