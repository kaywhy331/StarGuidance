import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rotation = readFileSync(join(root, "scripts", "rotate-encryption-key.ts"), "utf8");
const rehearsal = readFileSync(
  join(root, "..", "..", ".github", "scripts", "rehearse-key-rotation.sh"),
  "utf8",
);

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

  it("makes the credentialed rehearsal synthetic-only, non-vacuous, and reversible", () => {
    expect(rotation).toContain("KEY_ROTATION_SYNTHETIC_ONLY");
    expect(rotation).toContain("KEY_ROTATION_REQUIRE_ROWS");
    expect(rotation).toContain("KEY_ROTATION_REQUIRE_CHANGES");
    expect(rehearsal).toContain("SYNTHETIC_DISPOSABLE_STAGING");
    expect(rehearsal).toContain("forward)");
    expect(rehearsal).toContain("rollback)");
    expect(rehearsal).toContain('run_rotation verify-current "$ORIGINAL_ENCRYPTION_KEY"');
    expect(rehearsal).not.toMatch(/echo.*(ENCRYPTION_KEY|REHEARSAL_KEY)/);
  });

  it("binds synthetic maintenance work through the forced-RLS application actor", () => {
    expect(rotation).toContain("from auth.users");
    expect(rotation).toContain("where email like 'sg-verify-%@starguidance.test'");
    expect(rotation).toContain("set local role ${APPLICATION_DATABASE_ROLE}");
    expect(rotation).toContain("request.jwt.claim.sub");
    expect(rotation).toContain("Synthetic Auth identity has no application user row");
    expect(rotation).not.toContain("non-synthetic identities exist");
    expect(rotation).not.toContain("outside_users");
  });
});
