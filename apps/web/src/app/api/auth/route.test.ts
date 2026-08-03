import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ signInWithOtp: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  createSupabaseServerClient: async () => ({ auth: { signInWithOtp: supabase.signInWithOtp } }),
}));

import { POST } from "./route";

/**
 * Sign-in initiation must tell the difference between "that address was
 * refused" and "the provider will not send another message just now". Reporting
 * a mail-quota rejection as a generic failure sends someone to correct an
 * address that was never the problem, and it makes staging verification look
 * like an application defect when it is an environment limit.
 */
function request(email = "sg-verify-probe@starguidance.test"): Request {
  return new Request("https://synthetic.invalid/api/auth", {
    method: "POST",
    headers: {
      origin: "https://synthetic.invalid",
      host: "synthetic.invalid",
      "content-type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
}

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("RUNTIME_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon-key");
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic.invalid/database");
  vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://synthetic.invalid");
});

afterEach(() => {
  vi.unstubAllEnvs();
  supabase.signInWithOtp.mockReset();
});

describe("passwordless sign-in initiation", () => {
  it("accepts an initiation the provider queued", async () => {
    supabase.signInWithOtp.mockResolvedValue({ error: null });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect((await response.json()).pending).toBe(true);
  });

  it("reports an exhausted mail quota as retryable, not as a rejected address", async () => {
    supabase.signInWithOtp.mockResolvedValue({
      error: { status: 429, code: "over_email_send_rate_limit", message: "rate limited" },
    });
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(429);
    expect(body.retryable).toBe(true);
    expect(body.error).toMatch(/try again shortly/i);
  });

  it("recognises the quota rejection from the provider code alone", async () => {
    supabase.signInWithOtp.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", message: "rate limited" },
    });
    expect((await POST(request())).status).toBe(429);
  });

  it("keeps every other provider failure generic", async () => {
    supabase.signInWithOtp.mockResolvedValue({
      error: { status: 400, code: "email_address_invalid", message: "invalid" },
    });
    const response = await POST(request());
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.retryable).toBeUndefined();
    // The provider's wording is never forwarded; it can quote the address.
    expect(JSON.stringify(body)).not.toContain("invalid");
  });

  it("never echoes the submitted address", async () => {
    supabase.signInWithOtp.mockResolvedValue({
      error: { status: 500, message: "boom for someone@private.test" },
    });
    const response = await POST(request("someone@private.test"));
    expect(JSON.stringify(await response.json())).not.toContain("someone@private.test");
  });
});
