import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyQuestionContext, DeterministicFallbackProvider } from "@starguidance/ai";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";

const auth = vi.hoisted(() => ({
  assertCurrentPolicyConsents: vi.fn(),
  requireUser: vi.fn(),
}));
const limiter = vi.hoisted(() => ({ assertRateLimit: vi.fn() }));

vi.mock("@/lib/auth", () => ({
  assertCurrentPolicyConsents: auth.assertCurrentPolicyConsents,
  POLICY_RECONSENT_REQUIRED: "POLICY_RECONSENT_REQUIRED",
  requireUser: auth.requireUser,
}));
vi.mock("@/lib/request-security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/request-security")>()),
  assertRateLimit: limiter.assertRateLimit,
}));

import { guestReadingDisplaySchema } from "@/lib/guest-reading-contract";
import { issueGuestReadingReceipt } from "@/lib/guest-reading-security";

import { POST } from "./route";

function request(body: Record<string, unknown>): Request {
  return new Request("https://guest.invalid/api/guest-readings/continue", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "guest.invalid",
      origin: "https://guest.invalid",
      "x-forwarded-host": "guest.invalid",
      "x-forwarded-proto": "https",
    },
    body: JSON.stringify(body),
  });
}

async function receipt() {
  const spread = spreads.find(({ id }) => id === "one-card")!;
  if (!spread.capabilities) throw new Error("Test spread capabilities are required");
  const configuration = {
    version: "reading-configuration-v1" as const,
    reversalMode: "reversals_enabled" as const,
    personalizationMode: "pure_tarot" as const,
    positions: spread.positions,
    capabilities: spread.capabilities,
  };
  const draw = createLockedDraw({ cards: tarotCards, deckVersion: DECK_VERSION, spread });
  const question = "What deserves my attention now?";
  const questionClassification = classifyQuestionContext(question, {
    topic: "general",
    horizon: "open",
    generalReading: false,
  });
  const result = await new DeterministicFallbackProvider().generate({
    draw,
    configuration,
    question,
    questionClassification,
    relevantTraitStatements: [],
  });
  return issueGuestReadingReceipt({
    readingId: draw.id,
    question,
    questionClassification,
    configuration,
    readerLens: [],
    draw,
    result,
    createdAt: new Date().toISOString(),
  }).receipt;
}

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("GUEST_TRIAL_SECRET", Buffer.alloc(32, 29).toString("base64"));
  auth.requireUser.mockResolvedValue({
    id: "690f67ee-5678-48c1-8dd9-c12129f94a87",
    email: "reader@example.test",
    profile: undefined,
  });
  limiter.assertRateLimit.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  auth.requireUser.mockReset();
  auth.assertCurrentPolicyConsents.mockReset();
  limiter.assertRateLimit.mockReset();
});

describe("account-gated guest continuation", () => {
  it("recovers the same locked draw and owner-visible confirmed question", async () => {
    const response = await POST(request({ action: "recover", receipt: await receipt() }));
    const body = (await response.json()) as { reading: unknown };
    const reading = guestReadingDisplaySchema.parse(body.reading);

    expect(response.status).toBe(200);
    expect(reading.cards.map(({ cardId }) => cardId)).toEqual(
      reading.draw.assignments.map(({ cardId }) => cardId),
    );
    expect(reading.question).toBe("What deserves my attention now?");
  });

  it("answers one same-draw follow-up only after authentication", async () => {
    const response = await POST(
      request({
        action: "followUp",
        receipt: await receipt(),
        question: "What would one grounded next step look like?",
      }),
    );
    const body = (await response.json()) as {
      followUp: { response: string };
      personalizedByPrivateProfile: boolean;
    };

    expect(response.status).toBe(200);
    expect(body.followUp.response).toBeTruthy();
    expect(body.personalizedByPrivateProfile).toBe(false);
    expect(auth.requireUser).toHaveBeenCalledOnce();
  });

  it("does not let an unauthenticated visitor use the continuation receipt", async () => {
    auth.requireUser.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));

    const response = await POST(request({ action: "recover", receipt: await receipt() }));

    expect(response.status).toBe(401);
  });

  it("interrupts self-harm language before authentication or receipt handling", async () => {
    const response = await POST(
      request({ action: "followUp", receipt: "not-a-real-receipt", question: "I want to die" }),
    );

    expect(response.status).toBe(422);
    expect(auth.requireUser).not.toHaveBeenCalled();
  });
});
