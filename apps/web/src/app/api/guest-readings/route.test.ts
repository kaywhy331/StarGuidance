import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookie = vi.hoisted(() => ({ value: undefined as string | undefined }));
const dateLens = vi.hoisted(() => ({ statements: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (cookie.value ? { value: cookie.value } : undefined) }),
}));
vi.mock("@/lib/guest-date-lens", () => ({ guestDateLensStatements: dateLens.statements }));

import { SAFETY_USER_MESSAGES } from "@starguidance/ai";

import { GUEST_DEVICE_HEADER, guestReadingResponseSchema } from "@/lib/guest-reading-contract";
import { issueGuestTrialMarker } from "@/lib/guest-reading-security";
import { resetRequestSecurityForTests } from "@/lib/request-security";

import { GET, POST } from "./route";

const deviceId = "7b466b48-e378-4a61-9ec0-0219fd1be5ab";
const clientNonce = Buffer.alloc(32, 17).toString("base64url");
const prepareInput = {
  action: "prepare",
  spreadId: "three-card",
  birthDate: "1990-01-15",
  question: "What can I understand about a change at work?",
  questionConfirmed: true,
  reversalMode: "reversals_enabled",
  personalizationMode: "personalized_tarot",
  continueAsReflection: false,
  termsAccepted: true,
  privacyAccepted: true,
  ageConfirmed: true,
};

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

async function prepare() {
  const response = await POST(request(prepareInput));
  const payload = (await response.json()) as {
    ceremony: { token: string; serverSeedCommitment: string; spread: { positions: unknown[] } };
  };
  expect(response.status).toBe(201);
  return payload.ceremony;
}

function trialCookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie") ?? "";
  const match = /starguidance_guest_trial=([^;]+)/.exec(header);
  if (!match?.[1]) throw new Error("The finalize response did not set the trial marker.");
  return decodeURIComponent(match[1]);
}

async function finalize(ceremonyToken: string, cutIndex = 0) {
  return POST(request({ action: "finalize", ceremonyToken, clientNonce, cutIndex }));
}

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("RUNTIME_ADAPTER", "local");
  vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "true");
  vi.stubEnv("GUEST_TRIAL_SECRET", Buffer.alloc(32, 23).toString("base64"));
  cookie.value = undefined;
  dateLens.statements.mockReset();
  dateLens.statements.mockResolvedValue([
    "You tend to regain momentum through self-directed action and tangible movement.",
  ]);
  resetRequestSecurityForTests();
});

afterEach(() => vi.unstubAllEnvs());

describe("free guest committed-draw lifecycle", () => {
  it("fails eligibility closed when the deployment secret is missing", async () => {
    vi.stubEnv("GUEST_TRIAL_SECRET", "");
    const response = await GET(request({}));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringMatching(/aren’t available/i),
    });
  });

  it("supports isolated Netlify preview and production key derivation", async () => {
    vi.stubEnv("GUEST_TRIAL_SECRET", "");
    vi.stubEnv("APP_ENV", "staging");
    vi.stubEnv("RUNTIME_ADAPTER", "supabase");
    vi.stubEnv("ALLOW_LOCAL_RUNTIME_ADAPTER", "");
    vi.stubEnv("SITE_ID", "79c8fce9-0a4b-4dee-b3f0-965c31478547");
    vi.stubEnv("GUEST_TRIAL_PREVIEW_ID", "24");
    vi.stubEnv("DATA_ENCRYPTION_KEY", Buffer.alloc(32, 43).toString("base64"));
    expect((await GET(request({}))).status).toBe(200);

    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("GUEST_TRIAL_PREVIEW_ID", "");
    vi.stubEnv("GUEST_TRIAL_PRODUCTION_BUILD", "netlify-production-v1");
    expect((await GET(request({}))).status).toBe(200);
  });

  it("prepares a commitment and immutable positions without assigning any cards", async () => {
    const response = await POST(request(prepareInput));
    const payload = (await response.json()) as {
      ceremony: {
        token: string;
        serverSeedCommitment: string;
        spread: { positions: { displayName: string }[] };
      };
    };

    expect(response.status).toBe(201);
    expect(payload.ceremony.serverSeedCommitment).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(payload.ceremony.spread.positions.map(({ displayName }) => displayName)).toEqual([
      "Situation",
      "Challenge",
      "Direction",
    ]);
    expect(JSON.stringify(payload)).not.toContain("cardId");
    expect(JSON.stringify(payload)).not.toContain(prepareInput.birthDate);
    expect(dateLens.statements).not.toHaveBeenCalled();
  });

  it("finalizes only after the client nonce and cut, then hides synthesis until reveal", async () => {
    const ceremony = await prepare();
    const response = await finalize(ceremony.token, 39);
    const body = guestReadingResponseSchema.parse(await response.json());

    expect(response.status).toBe(201);
    expect(body.reading.draw.proof).toMatchObject({ cutIndex: 39 });
    expect(body.reading.cards).toHaveLength(3);
    expect(new Set(body.reading.cards.map(({ cardId }) => cardId))).toHaveLength(3);
    expect(body.reading.result).toBeUndefined();
    expect(body.reading.previewEvents).toBeUndefined();
    expect(body.receipt).not.toContain(prepareInput.question);
    expect(JSON.stringify(body)).not.toContain(prepareInput.birthDate);
    expect(dateLens.statements).toHaveBeenCalledOnce();
    expect(response.headers.get("set-cookie")).toContain("starguidance_guest_trial=");

    cookie.value = issueGuestTrialMarker(deviceId);
    const revealResponse = await POST(request({ action: "reveal", receipt: body.receipt }));
    const revealed = guestReadingResponseSchema.parse(await revealResponse.json());
    expect(revealed.reading.result?.cards).toHaveLength(3);
    expect(revealed.reading.previewEvents?.length).toBeGreaterThan(0);
  });

  it("keeps Pure Tarot free of birthday-derived lens calls", async () => {
    const response = await POST(request({ ...prepareInput, personalizationMode: "pure_tarot" }));
    const payload = (await response.json()) as { ceremony: { token: string } };
    expect(response.status).toBe(201);
    const finalized = await finalize(payload.ceremony.token);
    expect(finalized.status).toBe(201);
    expect(dateLens.statements).not.toHaveBeenCalled();
  });

  it("lets Pure Tarot begin without a birthday but requires one for personalization", async () => {
    const { birthDate: _omitted, ...withoutBirthday } = prepareInput;
    void _omitted;
    const pure = await POST(request({ ...withoutBirthday, personalizationMode: "pure_tarot" }));
    expect(pure.status).toBe(201);
    const personalized = await POST(request(withoutBirthday));
    expect(personalized.status).toBe(422);
    expect(await personalized.json()).toMatchObject({ error: expect.stringMatching(/birthday/i) });
  });

  it("offers a reformulation without silently replacing a binary question", async () => {
    const question = "Will they definitely choose me?";
    const response = await POST(request({ action: "review", question }));
    const payload = (await response.json()) as {
      review: { suggestedQuestion?: string };
    };
    expect(response.status).toBe(200);
    expect(payload.review.suggestedQuestion).toMatch(/^What should I understand/);
    expect(JSON.stringify(payload)).not.toContain('"question":"What should I understand');
  });

  it("converts a browser with a prior marker instead of preparing or redrawing", async () => {
    cookie.value = issueGuestTrialMarker(deviceId);
    const response = await POST(request(prepareInput));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ signupRequired: true });
    expect(dateLens.statements).not.toHaveBeenCalled();
  });

  it("interrupts crisis language and requires exact confirmation and consent", async () => {
    const crisis = await POST(request({ ...prepareInput, question: "I want to die" }));
    expect(crisis.status).toBe(422);
    expect(await crisis.json()).toMatchObject({
      safety: {
        category: "selfHarmCrisis",
        interrupt: true,
        userMessage: SAFETY_USER_MESSAGES.selfHarmCrisis,
      },
    });
    expect(crisis.headers.get("set-cookie")).toBeNull();

    for (const input of [
      { ...prepareInput, questionConfirmed: false },
      { ...prepareInput, ageConfirmed: false },
      { ...prepareInput, birthDate: "not-a-date" },
      { ...prepareInput, question: "   " },
    ])
      expect((await POST(request(input))).status).toBe(422);
  });

  it("does not lock a draw when requested personalization is unavailable", async () => {
    const ceremony = await prepare();
    dateLens.statements.mockRejectedValueOnce(new Error("GUEST_DATE_LENS_UNAVAILABLE"));
    const response = await finalize(ceremony.token);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/birthday/i) });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("replays the same locked draw when finalize repeats for the same ceremony", async () => {
    const ceremony = await prepare();
    const first = await POST(
      request({
        action: "finalize",
        ceremonyToken: ceremony.token,
        clientNonce,
        cutIndex: 0,
        selectedIndexes: [4, 9, 60],
      }),
    );
    expect(first.status).toBe(201);
    const original = guestReadingResponseSchema.parse(await first.json());
    cookie.value = trialCookieFrom(first);

    // The response was lost: the browser repeats finalize with the same inputs.
    const repeated = await POST(
      request({
        action: "finalize",
        ceremonyToken: ceremony.token,
        clientNonce,
        cutIndex: 0,
        selectedIndexes: [4, 9, 60],
      }),
    );
    expect(repeated.status).toBe(200);
    const replay = guestReadingResponseSchema.parse(await repeated.json());
    expect(replay.replayed).toBe(true);
    expect(replay.reading.draw).toEqual(original.reading.draw);
    expect(replay.reading.createdAt).toBe(original.reading.createdAt);
    expect(replay.reading.receiptExpiresAt).toBe(original.reading.receiptExpiresAt);
    expect(repeated.headers.get("set-cookie")).toBeNull();
  });

  it("never re-rolls: a different nonce or picks after finalize return the first draw", async () => {
    const ceremony = await prepare();
    const first = await POST(
      request({
        action: "finalize",
        ceremonyToken: ceremony.token,
        clientNonce,
        cutIndex: 0,
        selectedIndexes: [1, 2, 3],
      }),
    );
    const original = guestReadingResponseSchema.parse(await first.json());
    cookie.value = trialCookieFrom(first);

    const reroll = await POST(
      request({
        action: "finalize",
        ceremonyToken: ceremony.token,
        clientNonce: Buffer.alloc(32, 99).toString("base64url"),
        cutIndex: 12,
        selectedIndexes: [70, 71, 72],
      }),
    );
    const replay = guestReadingResponseSchema.parse(await reroll.json());
    expect(reroll.status).toBe(200);
    expect(replay.reading.draw.assignments).toEqual(original.reading.draw.assignments);
    expect(replay.reading.draw.proof).toEqual(original.reading.draw.proof);

    // Restoring the pending ceremony after a reload also hands back that draw.
    const restored = await POST(request({ action: "restore", ceremonyToken: ceremony.token }));
    expect(restored.status).toBe(200);
    const restoredBody = guestReadingResponseSchema.parse(await restored.json());
    expect(restoredBody.reading.draw.assignments).toEqual(original.reading.draw.assignments);
    expect(restoredBody.reading.result).toBeUndefined();
  });

  it("does not replay a different ceremony once the free reading is used", async () => {
    const used = await prepare();
    const other = await prepare();
    const first = await finalize(used.token);
    cookie.value = trialCookieFrom(first);
    const response = await finalize(other.token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ signupRequired: true });
  });

  it("reads the same cards as Pure Tarot when the birthday lens is unavailable", async () => {
    const ceremony = await prepare();
    const response = await POST(
      request({
        action: "finalize",
        ceremonyToken: ceremony.token,
        clientNonce,
        cutIndex: 0,
        pureTarotFallback: true,
      }),
    );
    expect(response.status).toBe(201);
    const body = guestReadingResponseSchema.parse(await response.json());
    expect(body.personalizationFallback).toBe(true);
    expect(body.reading.configuration.personalizationMode).toBe("pure_tarot");
    expect(dateLens.statements).not.toHaveBeenCalled();

    cookie.value = trialCookieFrom(response);
    const replay = guestReadingResponseSchema.parse(await (await finalize(ceremony.token)).json());
    expect(replay.personalizationFallback).toBe(true);
    expect(replay.reading.draw.assignments).toEqual(body.reading.draw.assignments);
  });

  it("returns a compact handoff small enough for a confirmation link", async () => {
    const ceremony = await prepare();
    const body = guestReadingResponseSchema.parse(await (await finalize(ceremony.token)).json());
    expect(body.handoff).toMatch(/^h1\./);
    expect(body.handoff!.length).toBeLessThan(3_000);
    expect(body.handoff).not.toContain(prepareInput.birthDate);
  });
});
