import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  updateUser: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseServerClient: async () => ({ auth: supabase }),
}));

import { POST } from "./route";

function request(
  body: Record<string, unknown>,
  url = "https://synthetic.invalid/api/auth",
  browserHost = "synthetic.invalid",
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      origin: `https://${browserHost}`,
      host: browserHost,
      "x-forwarded-host": browserHost,
      "x-forwarded-proto": "https",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const credentials = {
  action: "sign-in",
  email: "reader@example.test",
  password: "a-private-passphrase",
};

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
  for (const mock of Object.values(supabase)) mock.mockReset();
});

describe("email and password authentication", () => {
  it("signs in with a password and never returns the credential", async () => {
    supabase.signInWithPassword.mockResolvedValue({ error: null });
    const response = await POST(request(credentials));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, authenticated: true });
    expect(supabase.signInWithPassword).toHaveBeenCalledWith({
      email: "reader@example.test",
      password: "a-private-passphrase",
    });
  });

  it("keeps a rejected credential generic", async () => {
    supabase.signInWithPassword.mockResolvedValue({
      error: { code: "invalid_credentials", message: "reader@example.test was refused" },
    });
    const response = await POST(request(credentials));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toMatch(/email or password/i);
    expect(JSON.stringify(body)).not.toContain("reader@example.test");
  });

  it("creates an immediately authenticated account when confirmation is disabled", async () => {
    supabase.signUp.mockResolvedValue({
      data: { session: { access_token: "redacted" } },
      error: null,
    });
    const response = await POST(
      request({ ...credentials, action: "sign-up", email: "New.Reader@Example.Test" }),
    );

    expect(await response.json()).toEqual({ ok: true, authenticated: true, pending: false });
    expect(supabase.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new.reader@example.test", password: credentials.password }),
    );
  });

  it("reports one-time confirmation as pending and uses the browser-visible preview host", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("SITE_NAME", "starguidance");
    supabase.signUp.mockResolvedValue({ data: { session: null }, error: null });
    const browserHost = "deploy-preview-4--starguidance.netlify.app";
    const response = await POST(
      request(
        { ...credentials, action: "sign-up" },
        "https://6a7389a677f16700083770ed--starguidance.netlify.app/api/auth",
        browserHost,
      ),
    );

    expect((await response.json()).pending).toBe(true);
    expect(supabase.signUp).toHaveBeenCalledWith({
      email: credentials.email,
      password: credentials.password,
      options: {
        emailRedirectTo:
          "https://deploy-preview-4--starguidance.netlify.app/auth/callback?next=%2Fonboarding",
      },
    });
  });

  it("starts password recovery without exposing whether an account exists", async () => {
    supabase.resetPasswordForEmail.mockResolvedValue({ error: null });
    const response = await POST(
      request({ action: "request-password-reset", email: credentials.email }),
    );

    expect(await response.json()).toEqual({ ok: true, pending: true });
    expect(supabase.resetPasswordForEmail).toHaveBeenCalledWith(credentials.email, {
      redirectTo: "https://synthetic.invalid/auth/callback?next=%2Freset-password",
    });
  });

  it("classifies the recovery mail quota separately from an invalid credential", async () => {
    supabase.resetPasswordForEmail.mockResolvedValue({
      error: { code: "over_email_send_rate_limit", message: "rate limited" },
    });
    const response = await POST(
      request({ action: "request-password-reset", email: credentials.email }),
    );

    expect(response.status).toBe(429);
    expect((await response.json()).retryable).toBe(true);
  });

  it("does not expose an account lookup failure during recovery", async () => {
    supabase.resetPasswordForEmail.mockResolvedValue({
      error: { code: "user_not_found", message: "reader@example.test does not exist" },
    });
    const response = await POST(
      request({ action: "request-password-reset", email: credentials.email }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, pending: true });
    expect(JSON.stringify(body)).not.toContain(credentials.email);
  });

  it("updates a password only through the authenticated recovery session", async () => {
    supabase.updateUser.mockResolvedValue({ error: null });
    const response = await POST(
      request({ action: "update-password", password: "a-new-private-passphrase" }),
    );

    expect(await response.json()).toEqual({ ok: true, authenticated: true });
    expect(supabase.updateUser).toHaveBeenCalledWith({ password: "a-new-private-passphrase" });
  });

  it("rejects short passwords before calling the provider", async () => {
    const response = await POST(request({ ...credentials, password: "too-short" }));

    expect(response.status).toBe(422);
    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
  });
});
