import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getRuntimeAdapter: vi.fn(),
  deleteApplicationAccount: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  deleteIdentity: vi.fn(),
  cookieDelete: vi.fn(),
  cookieGetAll: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ delete: mocks.cookieDelete, getAll: mocks.cookieGetAll }),
}));

vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE: "starguidance_session",
  requireUser: mocks.requireUser,
}));

vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({
    repositories: { privacy: { deleteAccount: mocks.deleteApplicationAccount } },
  }),
}));

vi.mock("@/lib/runtime", () => ({
  RuntimeConfigurationError: class RuntimeConfigurationError extends Error {},
  getRuntimeAdapter: mocks.getRuntimeAdapter,
}));

vi.mock("@/lib/supabase", () => ({
  createSupabaseServerClient: async () => ({
    auth: { signInWithPassword: mocks.signInWithPassword, signOut: mocks.signOut },
  }),
  createSupabaseAdminClient: () => ({ auth: { admin: { deleteUser: mocks.deleteIdentity } } }),
}));

// The distributed path needs a real getSystemDatabaseClient, which the
// full @/lib/runtime mock above doesn't provide — this route's rate limit
// isn't what these tests exercise, so bypass it the same way
// src/app/api/auth/route.test.ts does.
vi.mock("@/lib/request-security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/request-security")>()),
  assertRateLimit: vi.fn().mockResolvedValue(undefined),
}));

import { DELETE } from "./route";

function request(body: Record<string, unknown> = {}): Request {
  return new Request("https://synthetic.invalid/api/account", {
    method: "DELETE",
    headers: {
      origin: "https://synthetic.invalid",
      host: "synthetic.invalid",
      "x-forwarded-host": "synthetic.invalid",
      "x-forwarded-proto": "https",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      confirmation: "DELETE",
      password: "a-current-private-password",
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  mocks.requireUser.mockResolvedValue({ id: randomUUID(), email: "reader@example.test" });
  mocks.getRuntimeAdapter.mockReturnValue("supabase");
  mocks.signInWithPassword.mockResolvedValue({ error: null });
  mocks.deleteIdentity.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.cookieGetAll.mockReturnValue([
    { name: "sb-synthetic-auth-token", value: "redacted" },
    { name: "unrelated", value: "preserve" },
  ]);
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe("account deletion", () => {
  it("requires the current password before deleting anything", async () => {
    mocks.signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials" } });
    const response = await DELETE(request());

    expect(response.status).toBe(403);
    expect(mocks.deleteIdentity).not.toHaveBeenCalled();
    expect(mocks.deleteApplicationAccount).not.toHaveBeenCalled();
  });

  it("reports an ambiguous provider deletion failure without claiming that data is intact", async () => {
    mocks.deleteIdentity.mockResolvedValue({ error: { code: "provider_unavailable" } });
    const response = await DELETE(request());

    expect(response.status).toBe(502);
    expect(mocks.deleteApplicationAccount).not.toHaveBeenCalled();
    expect((await response.json()).error).toMatch(/could not confirm account deletion/i);
  });

  it("deletes the hosted identity first and relies on the enforced database cascade", async () => {
    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(mocks.deleteIdentity).toHaveBeenCalledOnce();
    expect(mocks.deleteApplicationAccount).not.toHaveBeenCalled();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sb-synthetic-auth-token");
    expect(mocks.cookieDelete).not.toHaveBeenCalledWith("unrelated");
  });

  it("keeps confirmed identity deletion successful when local sign-out throws", async () => {
    mocks.signOut.mockRejectedValue(new Error("provider timeout"));

    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(mocks.deleteIdentity).toHaveBeenCalledOnce();
    expect(mocks.cookieDelete).toHaveBeenCalledWith("sb-synthetic-auth-token");
  });

  it("uses the application deletion path only for the explicit local adapter", async () => {
    mocks.getRuntimeAdapter.mockReturnValue("local");
    const response = await DELETE(request());

    expect(response.status).toBe(200);
    expect(mocks.deleteApplicationAccount).toHaveBeenCalledOnce();
    expect(mocks.deleteIdentity).not.toHaveBeenCalled();
  });

  it("returns validation and authentication failures with distinct statuses", async () => {
    const invalid = await DELETE(request({ confirmation: "delete" }));
    expect(invalid.status).toBe(422);

    mocks.requireUser.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
    const unauthenticated = await DELETE(request());
    expect(unauthenticated.status).toBe(401);
  });
});
