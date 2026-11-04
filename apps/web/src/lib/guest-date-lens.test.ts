import { afterEach, describe, expect, it, vi } from "vitest";

const profile = vi.hoisted(() => ({ calculate: vi.fn() }));

vi.mock("./profile-engine", () => ({ calculateProfile: profile.calculate }));

import { guestDateLensStatements } from "./guest-date-lens";

const trait = (
  overrides: Partial<{
    domain: string;
    statement: string;
    sourceSystem: string;
    sourceRule: string;
    stability: string;
    lifeDomains: string[];
  }> = {},
) => ({
  domain: "coreMotivation",
  statement: "Stable date-derived core observation.",
  sourceSystem: "numerology",
  sourceRule: "pythagorean.life_path.agency",
  calculationVersion: "pythagorean-v3",
  stability: "stable",
  direction: "supportive",
  strength: 0.9,
  confidence: "high",
  lifeDomains: ["general", "career", "change"],
  ...overrides,
});

const classification = {
  version: "question-classification-v1",
  topic: "relationships",
  horizon: "open",
  intent: "clarity",
  generalReading: false,
} as const;

afterEach(() => profile.calculate.mockReset());

describe("guest birthday lens", () => {
  it("uses no invented birth name and retains only stable date-derived rules", async () => {
    profile.calculate.mockResolvedValue({
      numerology: { name_calculation_status: "unavailable", name_rendering: null },
      mappedTraits: [
        trait(),
        trait({
          domain: "relationshipNeeds",
          statement: "Name-derived statement that must not enter the guest reading.",
          sourceRule: "pythagorean.soul_urge.agency",
          lifeDomains: ["relationships"],
        }),
        trait({
          statement: "Uncertain cultural-system statement.",
          sourceSystem: "dreamspell",
          sourceRule: "dreamspell.tone.1",
          stability: "uncertain",
        }),
      ],
    });

    const statements = await guestDateLensStatements(
      "1990-01-15",
      "What can I understand about this relationship?",
      classification,
    );

    expect(profile.calculate).toHaveBeenCalledWith({
      fullBirthName: "∅",
      birthDate: "1990-01-15",
    });
    expect(statements).toEqual(["Stable date-derived core observation."]);
  });

  it("fails closed if the engine unexpectedly enables name-derived values", async () => {
    profile.calculate.mockResolvedValue({
      numerology: { name_calculation_status: "available", name_rendering: "SYNTHETIC" },
      mappedTraits: [trait()],
    });

    await expect(
      guestDateLensStatements("1990-01-15", "What deserves my attention?", classification),
    ).rejects.toThrow("GUEST_DATE_LENS_UNAVAILABLE");
  });
});
