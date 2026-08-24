import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authAdmin = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  generateLink: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ auth: { admin: authAdmin } })),
}));

import { signupActionPreservesRedirect } from "../../tests/staging/synthetic-auth";

const CALLBACK =
  "https://deploy-preview-42--starguidance.netlify.app/auth/callback?next=%2Fonboarding";

function actionLink(redirectTo: string): string {
  const link = new URL("https://synthetic-project.invalid/auth/v1/verify");
  link.searchParams.set("token", "opaque-one-time-value");
  link.searchParams.set("type", "signup");
  link.searchParams.set("redirect_to", redirectTo);
  return link.toString();
}

describe("staging Auth redirect probe", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic-project.invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-role-value");
    authAdmin.deleteUser.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("returns only a boolean, accepts an exact callback, and deletes the generated identity", async () => {
    authAdmin.generateLink.mockResolvedValue({
      data: {
        properties: { action_link: actionLink(CALLBACK) },
        user: { id: "00000000-0000-4000-8000-000000000042" },
      },
      error: null,
    });

    await expect(signupActionPreservesRedirect(CALLBACK)).resolves.toBe(true);
    expect(authAdmin.deleteUser).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000042");
  });

  it("rejects a provider fallback to localhost and still deletes the generated identity", async () => {
    authAdmin.generateLink.mockResolvedValue({
      data: {
        properties: { action_link: actionLink("http://localhost:3000") },
        user: { id: "00000000-0000-4000-8000-000000000043" },
      },
      error: null,
    });

    await expect(signupActionPreservesRedirect(CALLBACK)).resolves.toBe(false);
    expect(authAdmin.deleteUser).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000043");
  });

  it("fails closed when no action link is returned and still cleans up", async () => {
    authAdmin.generateLink.mockResolvedValue({
      data: { properties: {}, user: { id: "00000000-0000-4000-8000-000000000044" } },
      error: null,
    });

    await expect(signupActionPreservesRedirect(CALLBACK)).rejects.toThrow("returned no link");
    expect(authAdmin.deleteUser).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000044");
  });
});
