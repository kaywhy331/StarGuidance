import { describe, expect, it } from "vitest";

import { CRISIS_RESOURCES_VERSION } from "@/config/crisis-resources.v1";

import { crisisResourcesForLocale } from "./crisis-resources";

describe("versioned crisis-resource routing", () => {
  it.each([
    ["en-US", "us"],
    ["es-US", "us"],
    ["US", "us"],
    ["en-GB", "uk"],
    ["en-IE", "uk"],
    ["fr-FR", "international"],
    [undefined, "international"],
  ] as const)("maps %s to %s without server-side location inference", (locale, expected) => {
    expect(crisisResourcesForLocale(locale).region).toBe(expected);
  });

  it("carries an auditable content version and a working international fallback", () => {
    expect(CRISIS_RESOURCES_VERSION).toMatch(/^crisis-resources-\d{4}-\d{2}-\d{2}-v\d+$/);
    expect(crisisResourcesForLocale().contacts[0]?.href).toBe("https://findahelpline.com");
  });
});
