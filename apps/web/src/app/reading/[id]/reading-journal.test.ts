import { describe, expect, it } from "vitest";

import { JOURNAL_INVITE_AFTER_MS, journalInviteOpen } from "./reading-journal";

describe("journalInviteOpen", () => {
  const created = "2026-09-01T12:00:00.000Z";
  const createdMs = Date.parse(created);

  it("waits until the reading is about three days old", () => {
    expect(journalInviteOpen(created, createdMs + JOURNAL_INVITE_AFTER_MS - 1)).toBe(false);
    expect(journalInviteOpen(created, createdMs + JOURNAL_INVITE_AFTER_MS)).toBe(true);
  });

  it("stays closed for an unreadable date", () => {
    expect(journalInviteOpen("not a date", createdMs)).toBe(false);
  });
});
