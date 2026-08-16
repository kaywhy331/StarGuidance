import { afterEach, describe, expect, it, vi } from "vitest";

import { createSyntheticIdentity } from "../../tests/staging/synthetic-auth";
import {
  ACCOUNT_DISPLAY_NAME_METADATA_KEY,
  POLICY_CONSENT_METADATA_KEY,
  POLICY_VERSIONS,
} from "./policies";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("staging synthetic identities", () => {
  it("carry the same current required-policy receipts as public signup", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T22:00:00.000Z"));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://synthetic.supabase.invalid");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-service-role-key");
    vi.stubEnv("GITHUB_RUN_ID", "synthetic-run");
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "4978a7ef-c4a6-462d-befe-d286a38a772f" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", request);

    await createSyntheticIdentity("user A");

    const body = JSON.parse(String(request.mock.calls[0]?.[1]?.body)) as {
      app_metadata: Record<string, unknown>;
    };
    expect(body.app_metadata[ACCOUNT_DISPLAY_NAME_METADATA_KEY]).toBe("Synthetic user A");
    expect(body.app_metadata[POLICY_CONSENT_METADATA_KEY]).toEqual([
      {
        policy: "terms",
        version: POLICY_VERSIONS.terms,
        acceptedAt: "2026-08-11T22:00:00.000Z",
      },
      {
        policy: "privacy",
        version: POLICY_VERSIONS.privacy,
        acceptedAt: "2026-08-11T22:00:00.000Z",
      },
      {
        policy: "age-eligibility",
        version: POLICY_VERSIONS.ageEligibility,
        acceptedAt: "2026-08-11T22:00:00.000Z",
      },
    ]);
  });
});
