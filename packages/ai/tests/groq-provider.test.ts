import { afterEach, describe, expect, it, vi } from "vitest";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import type { LockedDraw } from "@starguidance/tarot-domain";

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
} satisfies LockedDraw;

const input = {
  draw,
  question: "Should I take the new role at work?",
  relevantTraitStatements: ["you commit quickly once a direction feels right."],
};

const originalResult = {
  title: "The direction ahead",
  directAnswer: "The spread points toward a deliberate next step.",
  centralTheme: "Structure and courage move together here.",
  cards: spread.positions.map((position, index) => ({
    positionId: position.id,
    cardId: tarotCards[index + 10]!.id,
    orientation: index === 1 ? ("reversed" as const) : ("upright" as const),
    traditionalMeaning: `${position.displayName} carries the traditional thread.`,
    personalizedMeaning: `Your profile pattern meets ${position.displayName}.`,
    questionConnection: `${position.displayName} clarifies the question.`,
  })),
  synthesis: "The cards favor preparation before commitment.",
  likelyTrajectory: {
    summary: "Preparation strengthens the path.",
    conditions: ["Create a workable structure."],
    alternateTrajectory: "Acting too early scatters the effort.",
  },
  userAgency: ["Choose the next concrete milestone."],
  reflectionQuestion: "What would make you feel ready?",
  disconfirmingEvidence: ["The structure is already complete."],
  uncertainty: "Conditions can change.",
  safetyFlags: [],
};

const followUpInput = {
  ...input,
  question: "What is the next concrete move?",
  originalResult,
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

  it("sends a follow-up only the locked spread, original reading, question, and profile lens", () => {
    const payload = provider().buildFollowUpPayload(followUpInput);
    expect(payload.originalReading.synthesis).toBe(originalResult.synthesis);
    expect(payload.readerLens).toEqual(input.relevantTraitStatements);
    expect(payload.cards.map(({ cardId }) => cardId)).toEqual(
      draw.assignments.map(({ cardId }) => cardId),
    );
    const serialised = JSON.stringify(payload);
    for (const forbidden of ["birthDate", "fullBirthName", "birthplace", "userId", "email"])
      expect(serialised).not.toContain(forbidden);
  });
});

describe("one-section follow-ups", () => {
  it("requests and validates one cohesive response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ response: "One focused answer." }) } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().generateFollowUp(followUpInput)).resolves.toEqual({
      response: "One focused answer.",
    });
    const request = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as {
      response_format: { json_schema: { name: string; schema: { required: string[] } } };
      messages: { content: string }[];
    };
    expect(request.response_format.json_schema).toMatchObject({
      name: "follow_up",
      schema: { required: ["response"] },
    });
    expect(request.messages[0]!.content).toContain("one cohesive response");
  });

  it("falls back to a single profile- and card-aware response on provider failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const result = await provider().generateFollowUp(followUpInput);
    expect(Object.keys(result)).toEqual(["response"]);
    expect(result.response).toContain(input.relevantTraitStatements[0]!);
    expect(result.response).toContain(tarotCards[12]!.name);
  });

  it("rejects a prohibited factual claim even when the follow-up schema is valid", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: JSON.stringify({ response: "Your partner is cheating." }) } },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await provider().generateFollowUp(followUpInput);
    expect(result.response).not.toContain("is cheating");
    expect(result.response).toContain(tarotCards[12]!.name);
  });
});

describe("high-risk generation safety", () => {
  it.each([
    ["medical diagnosis", "Do I have cancer?"],
    ["legal verdict", "What will the court verdict be?"],
    ["financial return", "Will this stock return a profit?"],
    ["infidelity", "Is my partner cheating?"],
    ["pregnancy", "Am I pregnant?"],
    ["physical death", "Will he die this year?"],
    ["criminal guilt", "Is he guilty of the crime?"],
    ["mental-health diagnosis", "Is she a narcissist?"],
    ["third-party secrets", "What is she hiding?"],
  ])("uses the guarded system instruction for %s", async (_label, question) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(originalResult) } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await provider().generate({ ...input, question });

    const request = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as {
      messages: { content: string }[];
    };
    expect(request.messages[0]!.content).toContain("a confident prediction could cause real harm");
  });

  it.each([
    ["guarantee", "Without a doubt, this outcome is yours."],
    ["legal verdict", "The court will rule in your favor."],
    ["investment return", "This stock will double."],
    ["employment guarantee", "You will get the job."],
    ["infidelity fact", "Your partner is cheating."],
    ["pregnancy fact", "You are pregnant."],
    ["physical death", "He will die next month."],
    ["medical diagnosis", "You have cancer."],
    ["mental-health diagnosis", "She is a narcissist."],
    ["criminal guilt", "He is guilty."],
    ["third-party secret", "She is hiding a secret from you."],
  ])("falls back on a schema-valid %s claim", async (_label, claim) => {
    const unsafeResult = { ...originalResult, directAnswer: claim };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(unsafeResult) } }] }),
            { status: 200 },
          ),
        ),
    );

    const { result, provenance } = await provider().generateWithProvenance(input);

    expect(result.directAnswer).not.toBe(claim);
    expect(provenance.providerId).toBe("deterministic-fallback-v1:after-groq-unsafe-response");
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
    const { result, provenance } = await provider().generateWithProvenance(input);
    // AI-002: nothing the model says may change which cards were drawn.
    for (const [index, position] of spread.positions.entries()) {
      expect(result.cards[index]!.positionId).toBe(position.id);
      expect(result.cards[index]!.cardId).toBe(tarotCards[index + 10]!.id);
      expect(result.cards[index]!.orientation).toBe(index === 1 ? "reversed" : "upright");
    }
    expect(result.directAnswer).toBe("A");
    expect(provenance).toEqual({
      providerId: "groq:test-model",
      promptVersion: "reader-voice-v1",
      schemaVersion: "reading-result-v1",
    });
  });
});

describe("a person always gets a reading (AI-015)", () => {
  it("falls back to the deterministic reader when the provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const { result, provenance } = await provider().generateWithProvenance(input);
    expect(result.directAnswer.length).toBeGreaterThan(0);
    expect(result.cards).toHaveLength(spread.positions.length);
    expect(provenance).toEqual({
      providerId: "deterministic-fallback-v1:after-groq-provider-unavailable",
      promptVersion: "deterministic-fallback-v1",
      schemaVersion: "reading-result-v1",
    });
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
    const { result, provenance } = await provider().generateWithProvenance(input);
    expect(result.cards).toHaveLength(spread.positions.length);
    expect(provenance.providerId).toBe("deterministic-fallback-v1:after-groq-invalid-response");
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
    const { result, provenance } = await slow.generateWithProvenance(input);
    expect(result.cards).toHaveLength(spread.positions.length);
    expect(provenance.providerId).toBe("deterministic-fallback-v1:after-groq-request-timeout");
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
    vi.stubEnv("AI_SAFETY_EVALUATION_APPROVED", "true");
    expect(createInterpretationProvider().id).toBe("groq:openai/gpt-oss-120b");
  });
});
