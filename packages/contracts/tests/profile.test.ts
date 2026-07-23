import { describe, expect, it } from "vitest";

import { birthProfileInputSchema, getProfileCompleteness } from "../src/profile";

const core = {
  fullBirthName: "Ada Lovelace",
  birthDate: "1815-12-10",
  birthTime: { kind: "unknown" as const },
};

describe("birth profile contract", () => {
  it("accepts date-only core profiles", () => {
    const parsed = birthProfileInputSchema.parse(core);
    expect(getProfileCompleteness(parsed)).toBe("core");
  });

  it("requires timezone context for exact times", () => {
    const result = birthProfileInputSchema.safeParse({
      ...core,
      birthTime: { kind: "exact", time: "08:15" },
    });
    expect(result.success).toBe(false);
  });

  it("keeps approximate time as a range", () => {
    const parsed = birthProfileInputSchema.parse({
      ...core,
      birthplace: { city: "London", countryCode: "GB", timeZone: "Europe/London" },
      birthTime: { kind: "approximate", start: "07:00", end: "09:00" },
    });
    expect(parsed.birthTime).toEqual({ kind: "approximate", start: "07:00", end: "09:00" });
    expect(getProfileCompleteness(parsed)).toBe("approximateTime");
  });

  it("preserves Unicode names", () => {
    expect(birthProfileInputSchema.parse({ ...core, fullBirthName: "李 小龍" }).fullBirthName).toBe(
      "李 小龍",
    );
  });
});
