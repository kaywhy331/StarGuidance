import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rotation = readFileSync(join(root, "scripts", "rotate-encryption-key.ts"), "utf8");

describe("key rotation coverage", () => {
  it("covers every persisted encrypted-field location", () => {
    for (const field of [
      "birth_profiles.encrypted_payload",
      "profile_components.payload.envelope",
      "reading_sessions.encrypted_question",
      "follow_up_questions.encrypted_question",
      "reading_feedback.encrypted_comment",
    ])
      expect(rotation, `${field} must participate in rotation`).toContain(field);
  });

  it("prints counts only, never ciphertext, plaintext, or key material", () => {
    expect(rotation).not.toMatch(
      /stdout\.write\([\s\S]{0,300}(row\.envelope|plaintext|DATA_ENCRYPTION_KEY)/,
    );
    expect(rotation).toContain("checked");
    expect(rotation).toContain("changed");
  });
});
