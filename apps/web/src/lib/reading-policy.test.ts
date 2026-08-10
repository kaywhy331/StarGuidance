import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredReading } from "@starguidance/database";

import {
  findRetainedReading,
  followUpLimit,
  normalizeReadingQuestion,
  rereadCooldownMs,
} from "./reading-policy";

const reading = {
  id: "reading-1",
  encryptedQuestion: "encrypted",
  createdAt: "2026-08-10T12:00:00.000Z",
} as StoredReading;

afterEach(() => vi.unstubAllEnvs());

describe("reading policy", () => {
  it("normalizes Unicode, case, whitespace, and punctuation for repeat detection", () => {
    expect(normalizeReadingQuestion("  WILL\u00a0I Take—The Role?! ")).toBe(
      normalizeReadingQuestion("will i take the role"),
    );
  });

  it("returns the retained reading and cooldown boundary for a recent repeat", () => {
    expect(
      findRetainedReading(
        [reading],
        "Will I take the role?",
        () => "  will i TAKE the role ",
        30 * 60_000,
        Date.parse("2026-08-10T12:10:00.000Z"),
      ),
    ).toEqual({ reading, availableAt: "2026-08-10T12:30:00.000Z" });
  });

  it("does not retain a different, expired, or unreadable question", () => {
    const now = Date.parse("2026-08-10T13:00:00.000Z");
    expect(
      findRetainedReading([reading], "A different question", () => "original", 60_000, now),
    ).toBeUndefined();
    expect(
      findRetainedReading([reading], "original", () => "original", 60_000, now),
    ).toBeUndefined();
    expect(
      findRetainedReading(
        [reading],
        "original",
        () => {
          throw new Error("tampered");
        },
        2 * 60 * 60_000,
        now,
      ),
    ).toBeUndefined();
  });

  it("uses bounded configuration with safe defaults", () => {
    expect(followUpLimit()).toBe(1);
    expect(rereadCooldownMs()).toBe(30 * 60_000);
    vi.stubEnv("READING_FOLLOW_UP_LIMIT", "3");
    vi.stubEnv("READING_REREAD_COOLDOWN_MINUTES", "45");
    expect(followUpLimit()).toBe(3);
    expect(rereadCooldownMs()).toBe(45 * 60_000);
    vi.stubEnv("READING_FOLLOW_UP_LIMIT", "999");
    vi.stubEnv("READING_REREAD_COOLDOWN_MINUTES", "not-a-number");
    expect(followUpLimit()).toBe(1);
    expect(rereadCooldownMs()).toBe(30 * 60_000);
  });
});
