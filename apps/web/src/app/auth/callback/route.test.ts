import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
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
  auth.verifyOtp.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("passwordless callback", () => {
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
    const response = await GET(request(`?token_hash=${"b".repeat(64)}&type=magiclink`));

    expect(location(response).searchParams.get("error")).toBe("expired-link");
    expect(location(response).toString()).not.toContain("sensitive provider response");
  });
});
