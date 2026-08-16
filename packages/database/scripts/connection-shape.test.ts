import { describe, expect, it } from "vitest";

import { connectionAdvice, describeConnection, scrubHosts } from "./connection-shape";

describe("connection shape", () => {
  it("flags Supabase's transaction pooler, which cannot run migrations", () => {
    const shape = describeConnection(
      "postgresql://user:secret@aws-0-eu-west-1.pooler.supabase.com:6543/postgres",
    );
    expect(shape.port).toBe(6543);
    expect(shape.likelyTransactionPooler).toBe(true);
    expect(shape.likelyPoolerHost).toBe(true);
    expect(connectionAdvice(shape).join(" ")).toContain("transaction pooler");
  });

  it("accepts the session pooler on 5432", () => {
    const shape = describeConnection(
      "postgresql://user:secret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres",
    );
    expect(shape.likelyTransactionPooler).toBe(false);
    expect(shape.likelyPoolerHost).toBe(true);
    expect(connectionAdvice(shape)).toEqual([]);
  });

  it("warns that a direct Supabase host is commonly IPv6-only", () => {
    const shape = describeConnection(
      "postgresql://user:secret@db.abcdefgh.supabase.co:5432/postgres",
    );
    expect(shape.likelyDirectSupabaseHost).toBe(true);
    expect(connectionAdvice(shape).join(" ")).toContain("IPv6-only");
    // Advice must not embed a literal hostname pattern.
    expect(connectionAdvice(shape).join(" ")).not.toMatch(/supabase\.(co|com)/);
  });

  it("defaults an omitted port to 5432", () => {
    expect(describeConnection("postgresql://user:secret@example.internal/postgres").port).toBe(
      5432,
    );
  });

  it("reports credential completeness without exposing any component", () => {
    const shape = describeConnection("postgresql://user:secret@example.internal:5432/appdb");
    expect(shape).toMatchObject({ hasUsername: true, hasPassword: true, hasDatabaseName: true });
    // The shape must never carry the secret parts of the URL.
    expect(JSON.stringify(shape)).not.toContain("secret");
    expect(JSON.stringify(shape)).not.toContain("example.internal");
    expect(JSON.stringify(shape)).not.toContain("appdb");
  });

  it("notices a missing password or database name", () => {
    const shape = describeConnection("postgresql://user@example.internal:5432/");
    expect(shape.hasPassword).toBe(false);
    expect(shape.hasDatabaseName).toBe(false);
    expect(connectionAdvice(shape)).toHaveLength(2);
  });

  it("captures a requested sslmode", () => {
    expect(
      describeConnection("postgresql://u:p@example.internal:5432/db?sslmode=require")
        .sslModeRequested,
    ).toBe("require");
  });
});

describe("host scrubbing", () => {
  it("removes the host from a DNS failure message", () => {
    const scrubbed = scrubHosts("EAI_AGAIN: getaddrinfo EAI_AGAIN db.abcdefgh.supabase.co");
    expect(scrubbed).not.toContain("abcdefgh");
    expect(scrubbed).toContain("[host]");
  });

  it("removes the host from a connection refused message", () => {
    expect(scrubHosts("ECONNREFUSED aws-0-eu-west-1.pooler.supabase.com:5432")).not.toContain(
      "pooler",
    );
  });

  it("leaves messages without a host untouched", () => {
    expect(scrubHosts("42501: permission denied for schema public")).toBe(
      "42501: permission denied for schema public",
    );
  });
});
