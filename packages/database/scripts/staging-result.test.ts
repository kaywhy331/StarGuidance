import { describe, expect, it } from "vitest";

import { redact } from "./staging-result";

describe("evidence redaction", () => {
  it("removes a hostname quoted by a driver or fetch error", () => {
    const scrubbed = redact(
      "Failed to parse URL from abcdefgh.supabase.co/auth/v1/admin/users?page=1",
    );
    expect(scrubbed).not.toContain("abcdefgh");
    expect(scrubbed).not.toContain("supabase.co");
  });

  it("removes a deploy preview hostname", () => {
    expect(redact("probing deploy-preview-4--starguidance.netlify.app")).not.toContain("netlify");
  });

  it("removes connection strings, tokens, keys and addresses", () => {
    expect(redact("postgresql://user:pw@host.example.com/db")).not.toContain("pw");
    expect(redact("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0")).not.toContain("eyJhbGci");
    expect(redact("key sb_secret_abcdefgh12345")).not.toContain("sb_secret_abcdefgh12345");
    expect(redact("Bearer abcdef123456")).not.toContain("abcdef123456");
    expect(redact("mailto person@example.com")).not.toContain("person@example.com");
  });

  it("removes raw identifiers", () => {
    expect(redact("subject 9c649282-1c11-4ed4-a2a6-310dd0212694")).not.toContain("9c649282");
  });

  it("leaves ordinary status text intact", () => {
    for (const text of [
      "17 of 17 forced",
      "2 applied: 0000_busy_centennial, 0001_supabase_staging",
      "cards=78 spreads=4 positions=16",
      "server reports PostgreSQL 17.6",
      "42501: permission denied for schema public",
      "port 5432; transaction pooler false",
    ])
      expect(redact(text)).toBe(text);
  });

  it("caps runaway detail text", () => {
    expect(redact("x".repeat(1000)).length).toBeLessThanOrEqual(300);
  });
});
