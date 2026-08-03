import { afterEach, describe, expect, it, vi } from "vitest";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";

import { createInterpretationProvider, GroqInterpretationProvider } from "../src/index";

const spread = spreads.find(({ id }) => id === "direction")!;
const draw = {
  id: "draw",
  deckVersion: DECK_VERSION,
  spreadId: "direction",
  spreadVersion: spread.version,
  shuffleVersion: "secure-fisher-yates-v1",
  lockedAt: new Date(0).toISOString(),
  assignments: spread.positions.map((position, index) => ({
    positionId: position.id,
    cardId: tarotCards[index + 10]!.id,
    orientation: index === 1 ? ("reversed" as const) : ("upright" as const),
    order: index,
  })),
} as never;

const input = {
  draw,
  question: "Should I take the new role at work?",
  relevantTraitStatements: ["you commit quickly once a direction feels right."],
};

const provider = () =>
  new GroqInterpretationProvider({ apiKey: "synthetic-key", model: "test-model" });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("what leaves the machine", () => {
  it("sends the locked draw, its meanings, the question and the lens — and nothing else", () => {
    const payload = provider().buildPayload(input);
    expect(Object.keys(payload).sort()).toEqual([
      "answerPositionId",
      "cards",
      "question",
      "readerLens",
      "spreadId",
    ]);
    // AI-003: no raw birth name, birth date, birthplace, or account identifier.
    const serialised = JSON.stringify(payload);
    for (const forbidden of ["birthDate", "fullBirthName", "birthplace", "userId", "email"])
      expect(serialised).not.toContain(forbidden);
  });

  it("carries each card's position function, so the model can read position (AI-005)", () => {
    const payload = provider().buildPayload(input);
    for (const [index, position] of spread.positions.entries()) {
      expect(payload.cards[index]!.positionId).toBe(position.id);
      expect(payload.cards[index]!.positionMeans).toBe(position.interpretiveFunction);
    }
  });
});

describe("the draw is authoritative, not the model", () => {
  it("restores card identity and orientation even when the model returns different ones", async () => {
    const invented = {
      title: "T",
      directAnswer: "A",
      centralTheme: "C",
      cards: spread.positions.map(() => ({
        positionId: "invented",
        cardId: "major-00",
        orientation: "upright",
        traditionalMeaning: "m",
        personalizedMeaning: "p",
        questionConnection: "q",
      })),
      synthesis: "S",
      likelyTrajectory: { summary: "s", conditions: ["c"], alternateTrajectory: "a" },
      userAgency: ["u"],
      reflectionQuestion: "r",
      disconfirmingEvidence: ["d"],
      uncertainty: "u",
      safetyFlags: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(invented) } }] }),
          {
            status: 200,
          },
        ),
      ),
    );
    const result = await provider().generate(input);
    // AI-002: nothing the model says may change which cards were drawn.
    for (const [index, position] of spread.positions.entries()) {
      expect(result.cards[index]!.positionId).toBe(position.id);
      expect(result.cards[index]!.cardId).toBe(tarotCards[index + 10]!.id);
      expect(result.cards[index]!.orientation).toBe(index === 1 ? "reversed" : "upright");
    }
    expect(result.directAnswer).toBe("A");
  });
});

describe("a person always gets a reading (AI-015)", () => {
  it("falls back to the deterministic reader when the provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const result = await provider().generate(input);
    expect(result.directAnswer.length).toBeGreaterThan(0);
    expect(result.cards).toHaveLength(spread.positions.length);
  });

  it("falls back when the provider returns something that is not a valid reading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"nonsense":true}' } }] }), {
          status: 200,
        }),
      ),
    );
    const result = await provider().generate(input);
    expect(result.cards).toHaveLength(spread.positions.length);
  });

  it("falls back rather than hanging when the provider does not answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
          ),
      ),
    );
    const slow = new GroqInterpretationProvider({
      apiKey: "synthetic-key",
      model: "test-model",
      timeoutMs: 30,
    });
    const result = await slow.generate(input);
    expect(result.cards).toHaveLength(spread.positions.length);
  });
});

describe("the staging kill switch", () => {
  it("uses the deterministic reader unless a provider is explicitly configured", () => {
    vi.stubEnv("AI_PROVIDER", "");
    vi.stubEnv("AI_PROVIDER_API_KEY", "");
    expect(createInterpretationProvider().id).toBe("deterministic-fallback-v1");

    vi.stubEnv("AI_PROVIDER", "disabled");
    vi.stubEnv("AI_PROVIDER_API_KEY", "synthetic-key");
    expect(createInterpretationProvider().id).toBe("deterministic-fallback-v1");

    // Configured but keyless must not pretend to be live either.
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("AI_PROVIDER_API_KEY", "");
    expect(createInterpretationProvider().id).toBe("deterministic-fallback-v1");
  });

  it("selects the live provider when both are present, and records the model in its id", () => {
    vi.stubEnv("AI_PROVIDER", "groq");
    vi.stubEnv("AI_PROVIDER_API_KEY", "synthetic-key");
    vi.stubEnv("AI_PROVIDER_MODEL", "openai/gpt-oss-120b");
    expect(createInterpretationProvider().id).toBe("groq:openai/gpt-oss-120b");
  });
});
