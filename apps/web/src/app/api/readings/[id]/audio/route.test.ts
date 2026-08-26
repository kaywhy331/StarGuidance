import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertRateLimit: vi.fn(),
  assertSameOrigin: vi.fn(),
  createReadingAudioProvider: vi.fn(),
  getReading: vi.fn(),
  requireUser: vi.fn(),
  stream: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/persistence", () => ({
  persistenceFor: () => ({ repositories: { readingSessions: { get: mocks.getReading } } }),
}));
vi.mock("@/lib/reading-audio", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/reading-audio")>()),
  createReadingAudioProvider: mocks.createReadingAudioProvider,
}));
vi.mock("@/lib/request-security", () => ({
  assertRateLimit: mocks.assertRateLimit,
  assertSameOrigin: mocks.assertSameOrigin,
  requestSecurityFailure: () => undefined,
}));

import { ReadingAudioProviderError } from "@/lib/reading-audio";

import { POST } from "./route";

const user = { id: "00000000-0000-4000-8000-000000000701", email: "reader@example.test" };
const readingId = "00000000-0000-4000-8000-000000000702";
const result = {
  schemaVersion: "reading-result-v3" as const,
  directAnswer: "The current pattern suggests one grounded step.",
  overallPattern: "Focus stays with observable action.",
  cards: [
    {
      positionId: "focus",
      positionLabel: "Focus",
      cardId: "major-00",
      orientation: "upright" as const,
      coreMeaning: "A willing beginning.",
      positionInterpretation: "The Focus position holds a willing beginning.",
      relationshipNotes: [],
      supportingEvidence: ["The Fool upright in Focus."],
    },
  ],
  synthesis: "The beginning becomes useful through one reversible action.",
  likelyTrajectory: null,
  alternatePath: null,
  timing: null,
  userAgency: "Choose one observable next step.",
  reflectionPrompt: "What can begin without certainty?",
  uncertaintyNote: "This reading is conditional and does not guarantee an outcome.",
  personalizationLens: null,
  safetyFlags: [],
};

function reading(overrides: Record<string, unknown> = {}) {
  return {
    id: readingId,
    draw: { assignments: [{ positionId: "focus" }] },
    ritualProgress: {
      phase: "followUpAvailable",
      revealedIndexes: [0],
    },
    result,
    followUps: [],
    ...overrides,
  };
}

function request(body: unknown): Request {
  return new Request(`https://starguidance.test/api/readings/${readingId}/audio`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://starguidance.test" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(user);
  mocks.getReading.mockResolvedValue(reading());
  mocks.stream.mockResolvedValue(new Response(new Uint8Array([73, 68, 51])).body);
  mocks.createReadingAudioProvider.mockReturnValue({ id: "fish-audio", stream: mocks.stream });
});

describe("reading audio route", () => {
  it("derives and streams only the requested persisted section", async () => {
    const response = await POST(request({ target: "primary", sequence: 0 }), {
      params: Promise.resolve({ id: readingId }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("x-reading-audio-format")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store, no-transform");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([73, 68, 51]));
    expect(mocks.stream).toHaveBeenCalledWith(
      "Your answer. The current pattern suggests one grounded step.",
      expect.any(AbortSignal),
    );
    expect(mocks.assertRateLimit).toHaveBeenCalledWith(`reading-audio:${user.id}`, 60, 3_600_000);
  });

  it("does not accept client-supplied narration prose", async () => {
    const response = await POST(
      request({ target: "primary", sequence: 0, text: "Spend provider credits on this." }),
      { params: Promise.resolve({ id: readingId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
  });

  it("keeps primary audio locked until every dealt card is revealed", async () => {
    mocks.getReading.mockResolvedValue(
      reading({ ritualProgress: { phase: "revealing", revealedIndexes: [] } }),
    );

    const response = await POST(request({ target: "primary", sequence: 0 }), {
      params: Promise.resolve({ id: readingId }),
    });

    expect(response.status).toBe(409);
    expect(mocks.createReadingAudioProvider).not.toHaveBeenCalled();
  });

  it("returns a safe unavailable response when Fish Audio is disabled", async () => {
    mocks.createReadingAudioProvider.mockImplementation(() => {
      throw new ReadingAudioProviderError("READING_AUDIO_DISABLED");
    });

    const response = await POST(request({ target: "primary", sequence: 0 }), {
      params: Promise.resolve({ id: readingId }),
    });
    const payload = (await response.json()) as { error: string };

    expect(response.status).toBe(503);
    expect(payload.error).toBe("Audio readings are not available in this environment.");
  });
});
