import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { createSupabaseServerClient } from "./supabase";

interface CookieUpdate {
  name: string;
  value: string;
  options?: Record<string, unknown>;
}

interface CapturedServerClientOptions {
  cookies: {
    getAll(): unknown[];
    setAll(values: CookieUpdate[]): void;
  };
}

function capturedOptions(): CapturedServerClientOptions {
  const options = mocks.createServerClient.mock.calls.at(-1)?.[2];
  if (!options) throw new Error("Supabase server-client options were not captured.");
  return options as CapturedServerClientOptions;
}

describe("Supabase server cookies", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.invalid");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "synthetic-anon-key");
    mocks.createServerClient.mockReturnValue({ auth: {} });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("persists refreshed cookies when the request context allows writes", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue({ getAll: () => [], set });

    await createSupabaseServerClient();
    const updates = [
      { name: "sb-access-token", value: "new-access", options: { httpOnly: true } },
      { name: "sb-refresh-token", value: "new-refresh", options: { sameSite: "lax" } },
    ];
    capturedOptions().cookies.setAll(updates);

    expect(set).toHaveBeenNthCalledWith(1, "sb-access-token", "new-access", {
      httpOnly: true,
    });
    expect(set).toHaveBeenNthCalledWith(2, "sb-refresh-token", "new-refresh", {
      sameSite: "lax",
    });
  });

  it("allows a Server Component to finish when Next rejects cookie mutation", async () => {
    const set = vi.fn(() => {
      throw new Error(
        "Cookies can only be modified in a Server Action or Route Handler. Read more: https://nextjs.org/docs/app/api-reference/functions/cookies#options",
      );
    });
    mocks.cookies.mockResolvedValue({ getAll: () => [], set });

    await createSupabaseServerClient();

    expect(() =>
      capturedOptions().cookies.setAll([{ name: "sb-access-token", value: "refreshed" }]),
    ).not.toThrow();
  });

  it("does not hide an unrelated cookie-store failure", async () => {
    const set = vi.fn(() => {
      throw new Error("cookie storage unavailable");
    });
    mocks.cookies.mockResolvedValue({ getAll: () => [], set });

    await createSupabaseServerClient();

    expect(() =>
      capturedOptions().cookies.setAll([{ name: "sb-access-token", value: "refreshed" }]),
    ).toThrow("cookie storage unavailable");
  });
});
