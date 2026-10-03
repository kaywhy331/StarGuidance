import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyQuestionContext, DeterministicFallbackProvider } from "@starguidance/ai";
import type { StoredReading } from "@starguidance/database";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";

const auth = vi.hoisted(() => ({
  assertCurrentPolicyConsents: vi.fn(),
  requireUser: vi.fn(),
}));
const limiter = vi.hoisted(() => ({ assertRateLimit: vi.fn() }));
const history = vi.hoisted(() => ({
  saved: new Map<string, StoredReading>(),
  importGuestReading: vi.fn(),
  getByIdempotencyKey: vi.fn(),
  createFollowUp: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  assertCurrentPolicyConsents: auth.assertCurrentPolicyConsents,
  POLICY_RECONSENT_REQUIRED: "POLICY_RECONSENT_REQUIRED",
  requireUser: auth.requireUser,
}));
vi.mock("@/lib/request-security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/request-security")>()),
  assertRateLimit: limiter.assertRateLimit,
}));
vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({
    encrypt: (value: string, dataClass: string) => `sealed:${dataClass}:${value}`,
    decrypt: (value: string) => value,
    repositories: {
      readingSessions: {
        importGuestReading: history.importGuestReading,
        getByIdempotencyKey: history.getByIdempotencyKey,
      },
      followUps: { create: history.createFollowUp },
    },
  }),
  recordAudit: history.recordAudit,
}));

import { guestReadingDisplaySchema } from "@/lib/guest-reading-contract";
import {
  issueGuestReadingHandoff,
  issueGuestReadingReceipt,
  verifyGuestReadingReceipt,
} from "@/lib/guest-reading-security";

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

const readerId = "690f67ee-5678-48c1-8dd9-c12129f94a87";

beforeEach(() => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("GUEST_TRIAL_SECRET", Buffer.alloc(32, 29).toString("base64"));
  auth.requireUser.mockResolvedValue({
    id: readerId,
    email: "reader@example.test",
    profile: undefined,
  });
  limiter.assertRateLimit.mockResolvedValue(undefined);
  history.saved.clear();
  history.importGuestReading.mockImplementation(async (reading: StoredReading) => {
    const key = `${reading.userId}:${reading.idempotencyKey}`;
    const existing = history.saved.get(key);
    if (existing) return existing;
    history.saved.set(key, reading);
    return reading;
  });
  history.getByIdempotencyKey.mockImplementation(async (userId: string, idempotencyKey: string) =>
    history.saved.get(`${userId}:${idempotencyKey}`),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  auth.requireUser.mockReset();
  auth.assertCurrentPolicyConsents.mockReset();
  limiter.assertRateLimit.mockReset();
  history.importGuestReading.mockReset();
  history.getByIdempotencyKey.mockReset();
  history.createFollowUp.mockReset();
  history.recordAudit.mockReset();
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

  it("reopens the same cards from a compact confirmation-link handoff", async () => {
    const issued = await receipt();
    const handoff = issueGuestReadingHandoff(verifyGuestReadingReceipt(issued)!);
    const original = guestReadingDisplaySchema.parse(
      (
        (await (await POST(request({ action: "recover", receipt: issued }))).json()) as {
          reading: unknown;
        }
      ).reading,
    );

    const response = await POST(request({ action: "redeem", handoff }));
    const body = (await response.json()) as { reading: unknown; receipt: string };
    const redeemed = guestReadingDisplaySchema.parse(body.reading);

    expect(response.status).toBe(200);
    expect(redeemed.draw).toEqual(original.draw);
    expect(redeemed.result?.directAnswer).toBe(original.result?.directAnswer);
    expect(redeemed.receiptExpiresAt).toBe(original.receiptExpiresAt);
    expect(verifyGuestReadingReceipt(body.receipt)?.readingId).toBe(original.id);
  });

  it("explains an expired or unknown handoff plainly", async () => {
    const response = await POST(
      request({
        action: "redeem",
        handoff: `h1.${"A".repeat(16)}.${"B".repeat(40)}.${"C".repeat(22)}`,
      }),
    );
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/7 days/) });
  });

  it("never saves the reading while recovering, redeeming, or answering a follow-up", async () => {
    const issued = await receipt();
    await POST(request({ action: "recover", receipt: issued }));
    await POST(
      request({
        action: "redeem",
        handoff: issueGuestReadingHandoff(verifyGuestReadingReceipt(issued)!),
      }),
    );
    await POST(
      request({
        action: "followUp",
        receipt: issued,
        question: "What would one grounded next step look like?",
      }),
    );

    expect(history.importGuestReading).not.toHaveBeenCalled();
  });

  it("asks for fresh cards when a follow-up changes the subject", async () => {
    const response = await POST(
      request({
        action: "followUp",
        receipt: await receipt(),
        question: "I have a different question about my new relationship.",
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "That’s a new question — it deserves its own fresh cards.",
      newReadingRequired: true,
    });
  });
});

describe("saving a guest reading to account history", () => {
  it("keeps the exact cards and interpretation only when the reader asks", async () => {
    const issued = await receipt();
    const guest = verifyGuestReadingReceipt(issued)!;

    const response = await POST(request({ action: "save", receipt: issued }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ readingId: guest.readingId, alreadySaved: false });
    const [saved] = history.importGuestReading.mock.calls[0] as [StoredReading];
    expect(saved).toMatchObject({
      id: guest.readingId,
      userId: readerId,
      idempotencyKey: `guest-trial:${guest.readingId}`,
      profileSnapshotId: null,
      source: "guest_trial",
      encryptedQuestion: "sealed:reading-question:What deserves my attention now?",
      configuration: guest.configuration,
      questionClassification: guest.questionClassification,
      readingLens: { version: "guest-date-lens-v1", traitIndexes: [], statements: [] },
      entitlementDecision: { mode: "guest-trial", outcome: "granted" },
      ritualProgress: { phase: "complete", revealedIndexes: [0] },
      generationStatus: "ready",
      followUps: [],
      createdAt: guest.createdAt,
    });
    expect(saved.draw).toEqual(guest.draw);
    expect(saved.result).toEqual(guest.result);
    expect(saved.encryptedServerSeed).toBeUndefined();
    expect(saved.outputProvenance?.providerId).toBe("deterministic-fallback-v1");
    expect(history.recordAudit).toHaveBeenCalledWith(
      readerId,
      "reading.guest_saved",
      "reading",
      guest.readingId,
    );
  });

  it("returns the same history entry when the reading is saved again", async () => {
    const issued = await receipt();
    await POST(request({ action: "save", receipt: issued }));

    const again = await POST(request({ action: "save", receipt: issued }));
    const recovered = await POST(request({ action: "recover", receipt: issued }));

    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ alreadySaved: true });
    expect(history.importGuestReading).toHaveBeenCalledOnce();
    expect(await recovered.json()).toMatchObject({
      savedReadingId: verifyGuestReadingReceipt(issued)!.readingId,
    });
  });

  it("brings along the follow-up already answered from these cards", async () => {
    const issued = await receipt();
    const question = "What would one grounded next step look like?";
    const answered = (await (
      await POST(request({ action: "followUp", receipt: issued, question }))
    ).json()) as { followUp: { response: string } };

    await POST(request({ action: "save", receipt: issued, followUpQuestion: question }));

    const [saved] = history.importGuestReading.mock.calls[0] as [StoredReading];
    expect(saved.followUps).toHaveLength(1);
    expect(saved.followUps[0]).toMatchObject({
      encryptedQuestion: `sealed:follow-up-question:${question}`,
      result: { response: answered.followUp.response },
      outputProvenance: { providerId: "deterministic-fallback-v1" },
    });
  });

  it("attaches a follow-up asked after an earlier save whose reply was lost", async () => {
    const issued = await receipt();
    const question = "What would one grounded next step look like?";
    await POST(request({ action: "save", receipt: issued }));
    history.createFollowUp.mockImplementation(
      async (userId: string, readingId: string, followUp: StoredReading["followUps"][number]) => {
        const key = `${userId}:guest-trial:${readingId}`;
        const reading = history.saved.get(key)!;
        history.saved.set(key, { ...reading, followUps: [...reading.followUps, followUp] });
      },
    );

    const again = await POST(
      request({ action: "save", receipt: issued, followUpQuestion: question }),
    );
    const repeat = await POST(
      request({ action: "save", receipt: issued, followUpQuestion: question }),
    );

    expect(await again.json()).toMatchObject({ alreadySaved: true });
    expect(await repeat.json()).toMatchObject({ alreadySaved: true });
    expect(history.importGuestReading).toHaveBeenCalledOnce();
    expect(history.createFollowUp).toHaveBeenCalledOnce();
    const saved = [...history.saved.values()][0]!;
    expect(saved.followUps).toHaveLength(1);
    expect(saved.followUps[0]).toMatchObject({
      encryptedQuestion: `sealed:follow-up-question:${question}`,
    });
  });

  it("treats a concurrent retry that already attached the follow-up as saved", async () => {
    const issued = await receipt();
    const question = "What would one grounded next step look like?";
    await POST(request({ action: "save", receipt: issued }));
    history.createFollowUp.mockRejectedValue(new Error("FOLLOW_UP_LIMIT_REACHED"));

    const response = await POST(
      request({ action: "save", receipt: issued, followUpQuestion: question }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ alreadySaved: true });
    expect(history.createFollowUp).toHaveBeenCalledOnce();
  });

  it("reports a retryable failure when the follow-up cannot be attached", async () => {
    const issued = await receipt();
    await POST(request({ action: "save", receipt: issued }));
    history.createFollowUp.mockRejectedValue(new Error("connection reset"));

    const response = await POST(
      request({
        action: "save",
        receipt: issued,
        followUpQuestion: "What would one grounded next step look like?",
      }),
    );

    expect(response.status).toBe(503);
    expect(history.importGuestReading).toHaveBeenCalledOnce();
  });

  it("leaves out a follow-up that would need fresh cards", async () => {
    await POST(
      request({
        action: "save",
        receipt: await receipt(),
        followUpQuestion: "I have a different question about my new relationship.",
      }),
    );

    const [saved] = history.importGuestReading.mock.calls[0] as [StoredReading];
    expect(saved.followUps).toEqual([]);
  });

  it("says plainly when another account already saved this free reading", async () => {
    history.importGuestReading.mockRejectedValueOnce(new Error("GUEST_READING_SAVED_ELSEWHERE"));

    const response = await POST(request({ action: "save", receipt: await receipt() }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ savedElsewhere: true });
  });

  it("keeps the reading in place when the account store cannot save it", async () => {
    history.importGuestReading.mockRejectedValueOnce(new Error("connection refused"));

    const response = await POST(request({ action: "save", receipt: await receipt() }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/still kept/) });
    expect(history.recordAudit).not.toHaveBeenCalled();
  });

  it("interrupts crisis language in a follow-up sent with a save", async () => {
    const response = await POST(
      request({ action: "save", receipt: await receipt(), followUpQuestion: "I want to die" }),
    );

    expect(response.status).toBe(422);
    expect(auth.requireUser).not.toHaveBeenCalled();
    expect(history.importGuestReading).not.toHaveBeenCalled();
  });

  it("refuses an expired receipt and an anonymous visitor", async () => {
    const expired = await POST(request({ action: "save", receipt: `v1.${"A".repeat(40)}` }));
    auth.requireUser.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
    const anonymous = await POST(request({ action: "save", receipt: await receipt() }));

    expect(expired.status).toBe(410);
    expect(anonymous.status).toBe(401);
    expect(history.importGuestReading).not.toHaveBeenCalled();
  });
});
