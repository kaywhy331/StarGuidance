import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookie.value ? { value: cookie.value } : undefined),
  }),
}));

import { GUEST_DEVICE_HEADER, guestReadingResponseSchema } from "@/lib/guest-reading-contract";
import { issueGuestTrialMarker } from "@/lib/guest-reading-security";
import { resetRequestSecurityForTests } from "@/lib/request-security";

import { GET, POST } from "./route";

const deviceId = "7b466b48-e378-4a61-9ec0-0219fd1be5ab";

function request(body: Record<string, unknown>): Request {
  return new Request("https://guest.invalid/api/guest-readings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [GUEST_DEVICE_HEADER]: deviceId,
      host: "guest.invalid",
      origin: "https://guest.invalid",
      "x-forwarded-host": "guest.invalid",
      "x-forwarded-proto": "https",
      "x-nf-client-connection-ip": "192.0.2.20",
    },
    body: JSON.stringify(body),
  });
}

const validInput = {
  spreadId: "three-card",
  question: "What can I understand about a change at work?",
  topic: "career",
  horizon: "weeks",
  generalReading: false,
  continueAsReflection: false,
  termsAccepted: true,
  privacyAccepted: true,
  ageConfirmed: true,
};

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("RUNTIME_ADAPTER", "local");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
  vi.stubEnv("GUEST_TRIAL_SECRET", Buffer.alloc(32, 23).toString("base64"));
  cookie.value = undefined;
  resetRequestSecurityForTests();
});

afterEach(() => vi.unstubAllEnvs());

describe("free guest reading", () => {
  it("fails eligibility closed when the deployment secret is missing", async () => {
    vi.stubEnv("GUEST_TRIAL_SECRET", "");

    const response = await GET(request({}));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/not configured/i),
    });
  });

  it("enables eligibility with the isolated Netlify deploy-preview key", async () => {
    vi.stubEnv("GUEST_TRIAL_SECRET", "");
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("RUNTIME_ADAPTER", "supabase");
    vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "");
    vi.stubEnv("SITE_ID", "79c8fce9-0a4b-4dee-b3f0-965c31478547");
    vi.stubEnv("GUEST_TRIAL_PREVIEW_ID", "24");
    vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 43).toString("base64"));

    const response = await GET(request({}));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ eligible: true, signupRequired: false });
  });

  it("returns one locked deterministic reading without returning the raw question", async () => {
    const response = await POST(request(validInput));
    const body = guestReadingResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(body.reading.cards).toHaveLength(3);
    expect(new Set(body.reading.cards.map(({ cardId }) => cardId))).toHaveLength(3);
    expect(body.reading.draw.id).toBe(body.reading.id);
    expect(body.receipt).not.toContain(validInput.question);
    expect(JSON.stringify(body.reading)).not.toContain(validInput.question);
    expect(response.headers.get("set-cookie")).toContain("starguidance_guest_trial=");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("converts a browser with a valid prior marker instead of redrawing", async () => {
    cookie.value = issueGuestTrialMarker(deviceId);

    const response = await POST(request(validInput));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ signupRequired: true });
  });

  it("interrupts immediate self-harm language before issuing a draw or trial marker", async () => {
    const response = await POST(request({ ...validInput, question: "I want to die" }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      safety: { category: "selfHarmCrisis", interrupt: true },
    });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("requires the guest policy and age acknowledgements", async () => {
    const response = await POST(request({ ...validInput, ageConfirmed: false }));

    expect(response.status).toBe(422);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
