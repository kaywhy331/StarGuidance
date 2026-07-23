import { afterEach, describe, expect, it, vi } from "vitest";

import { getRuntimeAdapter } from "./runtime";

afterEach(() => vi.unstubAllEnvs());

describe("runtime adapter policy", () => {
  it("fails closed without an explicit adapter", () => {
    vi.stubEnv("RUNTIME_ADAPTER", "");
    expect(() => getRuntimeAdapter()).toThrow(/explicitly select/);
  });

  it("requires explicit local authorization", () => {
    vi.stubEnv("RUNTIME_ADAPTER", "local");
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "false");
    expect(() => getRuntimeAdapter()).toThrow(/only when explicitly enabled/);
  });

  it("allows local only for explicitly authorized development and test", () => {
    vi.stubEnv("RUNTIME_ADAPTER", "local");
    vi.stubEnv("APP_ENV", "test");
    vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
    vi.stubEnv("SITE_ID", "");
    vi.stubEnv("SITE_NAME", "");
    expect(getRuntimeAdapter()).toBe("local");
  });

  it("rejects the local adapter in a deploy preview", () => {
    vi.stubEnv("RUNTIME_ADAPTER", "local");
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
    vi.stubEnv("SITE_ID", "synthetic-netlify-site-id");
    expect(() => getRuntimeAdapter()).toThrow(/only when explicitly enabled/);
  });

  it("fails closed when Supabase secrets are incomplete", () => {
    vi.stubEnv("RUNTIME_ADAPTER", "supabase");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    expect(() => getRuntimeAdapter()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
