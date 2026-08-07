import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  getUser: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("@/lib/recovery-session", () => ({
  issueRecoveryReceipt: () => "signed-recovery-receipt",
  RECOVERY_SESSION_COOKIE: "starguidance_password_recovery",
  RECOVERY_SESSION_TTL_SECONDS: 900,
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseServerClient: async () => ({ auth }),
}));

import { GET } from "./route";

function request(query = ""): Request {
  return new Request(`https://deploy-preview-4--starguidance.netlify.app/auth/callback${query}`);
}

function location(response: Response): URL {
  return new URL(response.headers.get("location") ?? "https://missing.invalid");
}

beforeEach(() => {
  vi.stubEnv("APP_ENV", "staging");
  vi.stubEnv("RUNTIME_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon-key");
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic.invalid/database");
  vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  auth.exchangeCodeForSession.mockReset();
  auth.getUser.mockReset();
  auth.verifyOtp.mockReset();
  auth.getUser.mockResolvedValue({
    data: { user: { id: "4978a7ef-c4a6-462d-befe-d286a38a772f" } },
    error: null,
  });
});

afterEach(() => vi.unstubAllEnvs());

describe("account callback", () => {
  it("exchanges a same-browser PKCE code and removes callback parameters", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(request("?code=synthetic-code&next=/onboarding"));

    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith("synthetic-code");
    expect(location(response).pathname).toBe("/onboarding");
    expect(location(response).search).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts a portable token-hash email link", async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    const tokenHash = "a".repeat(64);
    const response = await GET(request(`?next=/onboarding&token_hash=${tokenHash}&type=email`));

    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: tokenHash, type: "email" });
    expect(location(response).pathname).toBe("/onboarding");
  });

  it("opens a verified recovery session on the password reset page", async () => {
    auth.verifyOtp.mockResolvedValue({ error: null });
    const tokenHash = "r".repeat(64);
    const response = await GET(
      request(`?next=/reset-password&token_hash=${tokenHash}&type=recovery`),
    );

    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: tokenHash, type: "recovery" });
    expect(location(response).pathname).toBe("/reset-password");
    expect(location(response).search).toBe("");
    expect(response.cookies.get("starguidance_password_recovery")?.value).toBe(
      "signed-recovery-receipt",
    );
  });

  it("does not treat an untyped PKCE code as password-recovery proof", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(request("?code=synthetic-code&next=/reset-password"));

    expect(location(response).pathname).toBe("/sign-in");
    expect(location(response).searchParams.get("error")).toBe("invalid-link");
  });

  it("returns a Netlify callback to the browser-visible preview host", async () => {
    vi.stubEnv("SITE_NAME", "starguidance");
    auth.verifyOtp.mockResolvedValue({ error: null });
    const tokenHash = "c".repeat(64);
    const browserHost = "deploy-preview-4--starguidance.netlify.app";
    const response = await GET(
      new Request(
        `https://6a7389a677f16700083770ed--starguidance.netlify.app/auth/callback?next=/onboarding&token_hash=${tokenHash}&type=email`,
        {
          headers: {
            host: browserHost,
            "x-forwarded-host": browserHost,
            "x-forwarded-proto": "https",
          },
        },
      ),
    );

    expect(location(response).origin).toBe(`https://${browserHost}`);
    expect(location(response).pathname).toBe("/onboarding");
  });

  it("rejects a forwarded callback host outside the current Netlify site", async () => {
    vi.stubEnv("SITE_NAME", "starguidance");
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const internalOrigin = "https://6a7389a677f16700083770ed--starguidance.netlify.app";
    const response = await GET(
      new Request(`${internalOrigin}/auth/callback?code=synthetic-code`, {
        headers: {
          host: "attacker.invalid",
          "x-forwarded-host": "attacker.invalid",
          "x-forwarded-proto": "https",
        },
      }),
    );

    expect(location(response).origin).toBe(internalOrigin);
    expect(location(response).pathname).toBe("/onboarding");
  });

  it("explains when the PKCE verifier belongs to another browser", async () => {
    const error = new Error("private provider detail");
    error.name = "AuthPKCECodeVerifierMissingError";
    auth.exchangeCodeForSession.mockResolvedValue({ error });
    const response = await GET(request("?code=synthetic-code"));

    expect(location(response).pathname).toBe("/sign-in");
    expect(location(response).searchParams.get("error")).toBe("link-browser");
    expect(location(response).toString()).not.toContain("private provider detail");
  });

  it("rejects malformed token links and open redirect destinations", async () => {
    const response = await GET(request("?token_hash=short&type=email&next=//host.invalid"));

    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(location(response).pathname).toBe("/sign-in");
    expect(location(response).origin).toBe("https://deploy-preview-4--starguidance.netlify.app");
  });

  it("does not treat backslashes as a same-origin next destination", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await GET(request("?code=synthetic-code&next=/%5Chost.invalid/readings"));

    expect(location(response).pathname).toBe("/onboarding");
    expect(location(response).origin).toBe("https://deploy-preview-4--starguidance.netlify.app");
  });

  it("keeps provider failures private and asks for a fresh link", async () => {
    auth.verifyOtp.mockResolvedValue({ error: new Error("sensitive provider response") });
    const response = await GET(request(`?token_hash=${"b".repeat(64)}&type=email`));

    expect(location(response).searchParams.get("error")).toBe("expired-link");
    expect(location(response).toString()).not.toContain("sensitive provider response");
  });

  it("rejects a magiclink token type now that no flow issues one", async () => {
    const response = await GET(request(`?token_hash=${"m".repeat(64)}&type=magiclink`));

    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(location(response).pathname).toBe("/sign-in");
    expect(location(response).searchParams.get("error")).toBe("invalid-link");
  });
});
