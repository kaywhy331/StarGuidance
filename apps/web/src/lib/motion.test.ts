import { describe, expect, it } from "vitest";

import { usesLinuxWebKitCompositor } from "./motion";

describe("Linux WebKit compositor detection", () => {
  it("recognizes WPE and WebKitGTK even behind a Safari user agent", () => {
    expect(
      usesLinuxWebKitCompositor({ platform: "Linux x86_64", vendor: "Apple Computer, Inc." }),
    ).toBe(true);
    expect(
      usesLinuxWebKitCompositor({ platform: "Linux aarch64", vendor: "Apple Computer, Inc." }),
    ).toBe(true);
  });

  it("leaves Safari on Apple platforms and other Linux browsers alone", () => {
    for (const browser of [
      { platform: "MacIntel", vendor: "Apple Computer, Inc." },
      { platform: "iPhone", vendor: "Apple Computer, Inc." },
      { platform: "iPad", vendor: "Apple Computer, Inc." },
      { platform: "Linux x86_64", vendor: "Google Inc." },
      { platform: "Linux x86_64", vendor: "" },
      { platform: "Win32", vendor: "Google Inc." },
    ])
      expect(usesLinuxWebKitCompositor(browser)).toBe(false);
  });
});
