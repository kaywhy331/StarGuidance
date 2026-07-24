import { describe, expect, it } from "vitest";

import { birthProfileInputSchema, getProfileCompleteness } from "../src/profile";

const core = {
  fullBirthName: "Ada Lovelace",
  birthDate: "1815-12-10",
};

describe("birth profile contract", () => {
  it("accepts date-only core profiles", () => {
    const parsed = birthProfileInputSchema.parse(core);
    expect(getProfileCompleteness(parsed)).toBe("core");
  });

  it("accepts a birth time without birthplace or timezone context", () => {
    const parsed = birthProfileInputSchema.parse({
      ...core,
      birthTime: "08:15",
    });
    expect(parsed.birthTime).toBe("08:15");
    expect(getProfileCompleteness(parsed)).toBe("core");
  });

  it("accepts the two optional fields as simple values", () => {
    const parsed = birthProfileInputSchema.parse({
      ...core,
      birthplace: "London, United Kingdom",
      birthTime: "07:00",
    });
    expect(parsed.birthplace).toBe("London, United Kingdom");
    expect(parsed.birthTime).toBe("07:00");
    expect(getProfileCompleteness(parsed)).toBe("complete");
  });

  it("accepts blank optional values", () => {
    const parsed = birthProfileInputSchema.parse({ ...core, birthplace: "  ", birthTime: "" });
    expect(parsed.birthplace).toBe("");
    expect(parsed.birthTime).toBe("");
    expect(getProfileCompleteness(parsed)).toBe("core");
  });

  it("preserves Unicode names", () => {
    expect(birthProfileInputSchema.parse({ ...core, fullBirthName: "李" }).fullBirthName).toBe(
      "李",
    );
  });
});
