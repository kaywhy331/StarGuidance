import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  getUser: vi.fn(),
  resend: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  signUp: vi.fn(),
  updateUser: vi.fn(),
}));
const admin = vi.hoisted(() => ({ deleteUser: vi.fn(), updateUserById: vi.fn() }));
const recovery = vi.hoisted(() => ({
  cookieDelete: vi.fn(),
  cookieGet: vi.fn(),
  verify: vi.fn(),
}));
const security = vi.hoisted(() => ({ recordSecurityAudit: vi.fn() }));
const rateLimit = vi.hoisted(() => ({ assert: vi.fn() }));
const telemetry = vi.hoisted(() => ({ record: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ delete: recovery.cookieDelete, get: recovery.cookieGet }),
}));

vi.mock("@/lib/recovery-session", () => ({
  RECOVERY_SESSION_COOKIE: "starguidance_password_recovery",
  verifyRecoveryReceipt: recovery.verify,
}));

// recordSecurityAudit is best-effort by contract (it swallows its own
// failures); mocked here so these tests assert when it is invoked without
// the real implementation reaching for a database.
vi.mock("@/lib/persistence", () => ({
  recordSecurityAudit: security.recordSecurityAudit,
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseServerClient: async () => ({ auth: supabase }),
  createSupabaseAdminClient: () => ({ auth: { admin } }),
}));

// The distributed path opens a real Postgres connection (see
// src/lib/request-security.ts); DATABASE_URL below is a deliberately
// unreachable placeholder, same as this file's other synthetic hosts, so
// route logic can be exercised without a database. The Postgres-backed
// limiter itself is covered by
// packages/database/src/rate-limits.integration.test.ts against a real one.
vi.mock("@/lib/request-security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/request-security")>()),
  assertRateLimit: rateLimit.assert,
}));

vi.mock("@/lib/product-telemetry", () => ({
  tryRecordProductEvent: telemetry.record,
}));

import { DELETE, POST } from "./route";

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

function deleteRequest(): Request {
  return new Request("https://synthetic.invalid/api/auth", {
    method: "DELETE",
    headers: {
      origin: "https://synthetic.invalid",
      host: "synthetic.invalid",
      "x-forwarded-host": "synthetic.invalid",
      "x-forwarded-proto": "https",
    },
  });
}

const credentials = {
  action: "sign-in",
  email: "reader@example.test",
  password: "a-private-passphrase",
};
const consents = {
  termsAccepted: true,
  termsVersion: "terms-beta-2026-08-05",
  privacyAccepted: true,
  privacyVersion: "privacy-beta-2026-08-05",
  ageConfirmed: true,
  ageEligibilityVersion: "age-18-beta-2026-08-05",
  marketingAccepted: false,
  marketingVersion: "marketing-beta-v1",
};

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("RUNTIME_ADAPTER", "supabase");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.invalid");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon-key");
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic.invalid/database");
  vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://synthetic.invalid");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-role-key");
  admin.updateUserById.mockResolvedValue({ error: null });
  admin.deleteUser.mockResolvedValue({ error: null });
  recovery.cookieGet.mockReturnValue({ value: "signed-recovery-receipt" });
  recovery.verify.mockReturnValue(true);
  supabase.getUser.mockResolvedValue({
    data: { user: { id: "4978a7ef-c4a6-462d-befe-d286a38a772f" } },
    error: null,
  });
  supabase.signOut.mockResolvedValue({ error: null });
  supabase.resend.mockResolvedValue({ error: null });
  security.recordSecurityAudit.mockResolvedValue(undefined);
  rateLimit.assert.mockResolvedValue(undefined);
  telemetry.record.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const mock of Object.values(supabase)) mock.mockReset();
  for (const mock of Object.values(admin)) mock.mockReset();
  for (const mock of Object.values(recovery)) mock.mockReset();
  security.recordSecurityAudit.mockReset();
  rateLimit.assert.mockReset();
  telemetry.record.mockReset();
});

describe("email and password authentication", () => {
  it("reports a limiter dependency outage as unavailable rather than caller throttling", async () => {
    rateLimit.assert.mockRejectedValueOnce(new Error("RATE_LIMIT_UNAVAILABLE"));

    const response = await POST(request(credentials));

    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({
      error: "Authentication is temporarily unavailable. Try again shortly.",
    });
    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
  });

  it("reserves 429 for a caller that actually exhausted the request quota", async () => {
    rateLimit.assert.mockRejectedValueOnce(new Error("RATE_LIMITED"));

    const response = await POST(request(credentials));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ error: "Too many requests. Try again shortly." });
    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
  });

  it("signs in with a password and never returns the credential", async () => {
    supabase.signInWithPassword.mockResolvedValue({
      data: { user: { id: "4978a7ef-c4a6-462d-befe-d286a38a772f" } },
      error: null,
    });
    const response = await POST(request(credentials));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, authenticated: true });
    expect(security.recordSecurityAudit).toHaveBeenCalledWith(
      "4978a7ef-c4a6-462d-befe-d286a38a772f",
      "auth.signed_in",
    );
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
    expect(telemetry.record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "auth_failed",
        properties: { errorClass: "authentication", statusClass: "failed" },
      }),
    );
    expect(JSON.stringify(telemetry.record.mock.calls)).not.toContain("reader@example.test");
  });

  it("creates an immediately authenticated account when confirmation is disabled", async () => {
    supabase.signUp.mockResolvedValue({
      data: {
        session: { access_token: "redacted" },
        user: { id: "new-user", identities: [{ id: "identity" }], app_metadata: {} },
      },
      error: null,
    });
    const response = await POST(
      request({
        ...credentials,
        action: "sign-up",
        email: "New.Reader@Example.Test",
        displayName: "Nova",
        consents,
      }),
    );

    expect(await response.json()).toEqual({ ok: true, authenticated: true, pending: false });
    expect(supabase.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new.reader@example.test", password: credentials.password }),
    );
    expect(admin.updateUserById).toHaveBeenCalledWith(
      "new-user",
      expect.objectContaining({
        app_metadata: expect.objectContaining({
          starguidance_display_name: "Nova",
          starguidance_policy_consents: expect.arrayContaining([
            expect.objectContaining({ policy: "terms", version: consents.termsVersion }),
            expect.objectContaining({ policy: "privacy", version: consents.privacyVersion }),
            expect.objectContaining({
              policy: "age-eligibility",
              version: consents.ageEligibilityVersion,
            }),
          ]),
        }),
      }),
    );
    const metadata = admin.updateUserById.mock.calls[0]?.[1]?.app_metadata as {
      starguidance_policy_consents: { policy: string }[];
    };
    expect(metadata.starguidance_policy_consents).not.toContainEqual(
      expect.objectContaining({ policy: "marketing" }),
    );
  });

  it("stores optional marketing consent independently when selected", async () => {
    supabase.signUp.mockResolvedValue({
      data: {
        session: { access_token: "redacted" },
        user: { id: "marketing-user", identities: [{ id: "identity" }], app_metadata: {} },
      },
      error: null,
    });

    const response = await POST(
      request({
        ...credentials,
        action: "sign-up",
        displayName: "Nova",
        consents: { ...consents, marketingAccepted: true },
      }),
    );

    expect(response.status).toBe(200);
    expect(admin.updateUserById).toHaveBeenCalledWith(
      "marketing-user",
      expect.objectContaining({
        app_metadata: expect.objectContaining({
          starguidance_policy_consents: expect.arrayContaining([
            expect.objectContaining({ policy: "marketing", version: "marketing-beta-v1" }),
          ]),
        }),
      }),
    );
  });

  it("reports one-time confirmation as pending and uses the browser-visible preview host", async () => {
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("SITE_NAME", "starguidance");
    supabase.signUp.mockResolvedValue({
      data: {
        session: null,
        user: { id: "pending-user", identities: [{ id: "identity" }], app_metadata: {} },
      },
      error: null,
    });
    const browserHost = "deploy-preview-4--starguidance.netlify.app";
    const response = await POST(
      request(
        { ...credentials, action: "sign-up", displayName: "Nova", consents },
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

  it("resends signup confirmation without requiring another registration attempt", async () => {
    const response = await POST(
      request({ action: "resend-confirmation", email: credentials.email }),
    );

    expect(await response.json()).toEqual({ ok: true, pending: true });
    expect(supabase.resend).toHaveBeenCalledWith({
      type: "signup",
      email: credentials.email,
      options: { emailRedirectTo: "https://synthetic.invalid/auth/callback?next=%2Fonboarding" },
    });
    expect(supabase.signUp).not.toHaveBeenCalled();
  });

  it("keeps resend account state private and classifies mail quota errors", async () => {
    supabase.resend.mockResolvedValueOnce({
      error: { code: "user_not_found", message: "private account state" },
    });
    const privateResponse = await POST(
      request({ action: "resend-confirmation", email: credentials.email }),
    );
    expect(privateResponse.status).toBe(200);
    expect(JSON.stringify(await privateResponse.json())).not.toContain("private account state");

    supabase.resend.mockResolvedValueOnce({
      error: { code: "over_email_send_rate_limit", message: "quota" },
    });
    const limited = await POST(
      request({ action: "resend-confirmation", email: credentials.email }),
    );
    expect(limited.status).toBe(429);
    expect((await limited.json()).retryable).toBe(true);
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

  it("updates a password only through the authenticated recovery session and revokes sessions", async () => {
    supabase.updateUser.mockResolvedValue({ error: null });
    const response = await POST(
      request({ action: "update-password", password: "a-new-private-passphrase" }),
    );

    expect(await response.json()).toEqual({ ok: true, authenticated: false });
    expect(supabase.updateUser).toHaveBeenCalledWith({ password: "a-new-private-passphrase" });
    expect(supabase.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(recovery.cookieDelete).toHaveBeenCalledWith("starguidance_password_recovery");
    expect(security.recordSecurityAudit).toHaveBeenCalledWith(
      "4978a7ef-c4a6-462d-befe-d286a38a772f",
      "auth.password_changed",
    );
  });

  it("rejects a password update outside a verified recovery callback", async () => {
    recovery.verify.mockReturnValue(false);
    const response = await POST(
      request({ action: "update-password", password: "a-new-private-passphrase" }),
    );

    expect(response.status).toBe(403);
    expect(supabase.updateUser).not.toHaveBeenCalled();
  });

  it("rejects short passwords before calling the provider", async () => {
    const response = await POST(request({ ...credentials, password: "too-short" }));

    expect(response.status).toBe(422);
    expect(supabase.signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects sign-up unless every current policy is explicitly accepted", async () => {
    const response = await POST(
      request({
        ...credentials,
        action: "sign-up",
        displayName: "Nova",
        consents: { ...consents, ageConfirmed: false },
      }),
    );

    expect(response.status).toBe(422);
    expect(supabase.signUp).not.toHaveBeenCalled();
  });

  it("deletes the identity and ends any issued session when consent persistence fails", async () => {
    supabase.signUp.mockResolvedValue({
      data: {
        session: { access_token: "redacted" },
        user: { id: "unreceipted-user", identities: [{ id: "identity" }], app_metadata: {} },
      },
      error: null,
    });
    admin.updateUserById.mockResolvedValue({ error: { code: "provider_unavailable" } });

    const response = await POST(
      request({ ...credentials, action: "sign-up", displayName: "Nova", consents }),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/incomplete account was removed/i);
    expect(admin.deleteUser).toHaveBeenCalledWith("unreceipted-user");
    expect(supabase.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("ends any issued session when consent persistence and identity cleanup both fail", async () => {
    supabase.signUp.mockResolvedValue({
      data: {
        session: { access_token: "redacted" },
        user: { id: "uncertain-user", identities: [{ id: "identity" }], app_metadata: {} },
      },
      error: null,
    });
    admin.updateUserById.mockResolvedValue({ error: { code: "provider_unavailable" } });
    admin.deleteUser.mockRejectedValue(new Error("provider timeout"));

    const response = await POST(
      request({ ...credentials, action: "sign-up", displayName: "Nova", consents }),
    );

    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/cleanup could not be confirmed/i);
    expect(admin.deleteUser).toHaveBeenCalledWith("uncertain-user");
    expect(supabase.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("ends only the current browser session on explicit sign-out", async () => {
    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(200);
    expect(supabase.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(security.recordSecurityAudit).toHaveBeenCalledWith(
      "4978a7ef-c4a6-462d-befe-d286a38a772f",
      "auth.signed_out",
    );
  });

  it("does not report sign-out success when the provider rejects it", async () => {
    supabase.signOut.mockResolvedValue({ error: { code: "provider_unavailable" } });
    const response = await DELETE(deleteRequest());

    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/could not end/i);
    expect(security.recordSecurityAudit).not.toHaveBeenCalled();
  });
});
