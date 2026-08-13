import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DECK_VERSION,
  resolveSpreadPositions,
  spreads,
  tarotCards,
} from "@starguidance/tarot-content";
import type { LockedDraw } from "@starguidance/tarot-domain";

import {
  configuredGroqModelChain,
  createInterpretationProvider,
  GroqInterpretationProvider,
} from "../src/index";

const spread = spreads.find(({ id }) => id === "three-card")!;
const draw = {
  id: "draw",
  deckVersion: DECK_VERSION,
  spreadId: "three-card",
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
  questionClassification: {
    version: "question-classification-v1" as const,
    topic: "career" as const,
    horizon: "open" as const,
    intent: "decisionSupport" as const,
    generalReading: false,
  },
  relevantTraitStatements: ["you commit quickly once a direction feels right."],
};

const originalResult = {
  schemaVersion: "reading-result-v2" as const,
  title: "The direction ahead",
  passages: [
    {
      id: "opening",
      role: "opening" as const,
      text: "Something here is asking for a deliberate next step.",
      cardReferences: [spread.positions[2]!.id],
    },
    ...spread.positions.map((position, index) => ({
      id: `thread-${index + 1}`,
      role: "underlyingPattern" as const,
      text: `The ${index + 1} thread carries part of the developing pattern.`,
      cardReferences: [position.id],
    })),
    {
      id: "likely",
      role: "trajectory" as const,
      text: "I think preparation is going to make the next opening easier to recognize.",
      cardReferences: [spread.positions[2]!.id],
    },
    {
      id: "alternate",
      role: "alternative" as const,
      text: "Acting too early could scatter the effort, leaving a quieter route open.",
      cardReferences: [spread.positions[0]!.id],
    },
  ],
  cards: spread.positions.map((position, index) => ({
    positionId: position.id,
    cardId: tarotCards[index + 10]!.id,
    orientation: index === 1 ? ("reversed" as const) : ("upright" as const),
    passageIds: [`thread-${index + 1}`, ...(index === 2 ? ["opening", "likely"] : [])],
  })),
  trajectory: {
    likelyPassageId: "likely",
    conditions: ["Create a workable structure."],
    alternatePassageId: "alternate",
  },
  userAgency: ["Choose the next concrete milestone."],
  reflectionQuestion: "What would make you feel ready?",
  disconfirmingEvidence: ["The structure is already complete."],
  uncertainty: "Conditions can change.",
  safetyFlags: [],
};

const repairableLinkResult = {
  ...originalResult,
  passages: originalResult.passages.map((passage) => ({
    ...passage,
    cardReferences:
      passage.id === "thread-1"
        ? [originalResult.cards[0]!.cardId]
        : passage.cardReferences.filter(
            (positionId) => positionId !== draw.assignments[0]!.positionId,
          ),
  })),
  cards: originalResult.cards.map((card, index) =>
    index === 0 ? { ...card, passageIds: ["missing-passage"] } : card,
  ),
  trajectory: {
    ...originalResult.trajectory,
    likelyPassageId: "missing-likely",
    alternatePassageId: "missing-alternate",
  },
};

const followUpInput = {
  ...input,
  question: "What is the next concrete move?",
  originalResult,
};

const provider = () =>
  new GroqInterpretationProvider({ apiKey: "synthetic-key", model: "test-model" });

const fallbackProvider = (overrides: { timeoutMs?: number; totalTimeoutMs?: number } = {}) =>
  new GroqInterpretationProvider({
    apiKey: "synthetic-key",
    model: "openai/gpt-oss-120b",
    fallbackModels: ["llama-3.3-70b-versatile", "openai/gpt-oss-20b"],
    ...overrides,
  });

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
      "questionContext",
      "readerLens",
      "spreadId",
    ]);
    expect(payload.questionContext.topic).toBe("career");
    // AI-003: no raw birth name, birth date, birthplace, or account identifier.
    const serialised = JSON.stringify(payload);
    for (const forbidden of ["birthDate", "fullBirthName", "birthplace", "userId", "email"])
      expect(serialised).not.toContain(forbidden);
  });

  it("carries each card's position function, so the model can read position (AI-005)", () => {
    const payload = provider().buildPayload(input);
    const contextualPositions = resolveSpreadPositions(spread, input.questionClassification);
    for (const [index, position] of contextualPositions.entries()) {
      expect(payload.cards[index]!.positionId).toBe(position.id);
      expect(payload.cards[index]!.positionMeans).toBe(position.interpretiveFunction);
    }
  });

  it("sends a follow-up only the locked spread, original reading, question, and profile lens", () => {
    const payload = provider().buildFollowUpPayload(followUpInput);
    expect(payload.originalReading.passages).toEqual(originalResult.passages);
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
      response_format: {
        json_schema: {
          name: string;
          schema: { required: string[]; properties: { response: { minLength: number } } };
        };
      };
      messages: { content: string }[];
    };
    expect(request.response_format.json_schema).toMatchObject({
      name: "follow_up",
      schema: { required: ["response"], properties: { response: { minLength: 1 } } },
    });
    expect(request.messages[0]!.content).toContain("one cohesive response");
  });

  it("falls back to a single profile- and card-aware response on provider failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const result = await provider().generateFollowUp(followUpInput);
    expect(Object.keys(result)).toEqual(["response"]);
    expect(result.response).toContain(input.relevantTraitStatements[0]!.replace(/[.?!]+$/, ""));
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

  it("uses the same model chain for a follow-up without changing the locked draw", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify({ response: "A focused answer." }) } }],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fallbackProvider().generateFollowUp(followUpInput)).resolves.toEqual({
      response: "A focused answer.",
    });
    const requests = fetchMock.mock.calls.map(
      (call) =>
        JSON.parse(String(call[1]?.body)) as { model: string; messages: { content: string }[] },
    );
    expect(requests.map(({ model }) => model)).toEqual([
      "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile",
    ]);
    const lockedCardIds = draw.assignments.map(({ cardId }) => cardId);
    for (const request of requests) {
      const sent = JSON.parse(request.messages[1]!.content) as { cards: { cardId: string }[] };
      expect(sent.cards.map(({ cardId }) => cardId)).toEqual(lockedCardIds);
    }
  });
});

describe("model fallback chain", () => {
  it("uses strict schema, then validated JSON mode, and records the successful model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(originalResult) } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { result, provenance } = await fallbackProvider().generateWithProvenance(input);
    expect(result.cards).toHaveLength(draw.assignments.length);
    expect(provenance.providerId).toBe("groq:llama-3.3-70b-versatile");

    const requests = fetchMock.mock.calls.map(
      (call) =>
        JSON.parse(String(call[1]?.body)) as {
          model: string;
          messages: { content: string }[];
          response_format: { type: string; json_schema?: { strict?: boolean } };
        },
    );
    expect(requests.map(({ model }) => model)).toEqual([
      "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile",
    ]);
    expect(requests[0]!.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
    expect(requests[1]!.response_format).toEqual({ type: "json_object" });
    expect(requests[1]!.messages[0]!.content).toContain(
      "Return only one JSON object matching this JSON Schema exactly",
    );

    // Every attempt receives the same already-locked draw. A model retry is
    // never a card retry or a chance for the question/profile to select cards.
    const lockedCardIds = draw.assignments.map(({ cardId }) => cardId);
    for (const request of requests) {
      const sent = JSON.parse(request.messages[1]!.content) as { cards: { cardId: string }[] };
      expect(sent.cards.map(({ cardId }) => cardId)).toEqual(lockedCardIds);
    }
  });

  it("continues from invalid Llama JSON to strict GPT-OSS 20B", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: '{"nonsense":true}' } }] }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(originalResult) } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { provenance } = await fallbackProvider().generateWithProvenance(input);
    expect(provenance.providerId).toBe("groq:openai/gpt-oss-20b");
    const requests = fetchMock.mock.calls.map(
      (call) =>
        JSON.parse(String(call[1]?.body)) as {
          model: string;
          response_format: unknown;
          reasoning_effort?: string;
          include_reasoning?: boolean;
        },
    );
    expect(requests.map(({ model }) => model)).toEqual([
      "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-20b",
    ]);
    expect(requests[2]!.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
    for (const request of [requests[0]!, requests[2]!])
      expect(request).toMatchObject({ reasoning_effort: "low", include_reasoning: false });
    expect(requests[1]).toEqual(
      expect.not.objectContaining({
        reasoning_effort: expect.anything(),
        include_reasoning: expect.anything(),
      }),
    );
  });

  it("rejects a truncated completion and advances to the next model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: { content: JSON.stringify(originalResult) },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              { finish_reason: "stop", message: { content: JSON.stringify(originalResult) } },
            ],
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { provenance } = await fallbackProvider().generateWithProvenance(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(provenance.providerId).toBe("groq:llama-3.3-70b-versatile");
  });

  it("does not retry a shared authentication failure on other Groq models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const { provenance } = await fallbackProvider().generateWithProvenance(input);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(provenance.providerId).toBe("deterministic-fallback-v1:after-groq-authentication");
  });

  it("continues after a model-specific authorization rejection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 403 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(originalResult) } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { provenance } = await fallbackProvider().generateWithProvenance(input);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(provenance.providerId).toBe("groq:llama-3.3-70b-versatile");
  });

  it("bounds the whole chain even when individual models hang", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const pending = fallbackProvider({
        timeoutMs: 10_000,
        totalTimeoutMs: 15_000,
      }).generateWithProvenance(input);
      await vi.runAllTimersAsync();
      const { provenance } = await pending;
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(provenance.providerId).toBe("deterministic-fallback-v1:after-groq-request-timeout");
    } finally {
      vi.useRealTimers();
    }
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
    const unsafeResult = {
      ...originalResult,
      passages: originalResult.passages.map((passage, index) =>
        index === 0 ? { ...passage, text: claim } : passage,
      ),
    };
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

    expect(result.passages[0]?.text).not.toBe(claim);
    expect(provenance.providerId).toBe("deterministic-fallback-v1:after-groq-unsafe-response");
  });
});

describe("the draw is authoritative, not the model", () => {
  it("constrains the provider schema to the locked draw cardinality", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(originalResult) } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await provider().generateWithProvenance(input);

    const request = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body)) as {
      response_format: {
        json_schema: {
          schema: {
            properties: {
              title: { minLength: number };
              passages: {
                items: {
                  properties: {
                    id: { minLength: number };
                    text: { minLength: number };
                  };
                };
              };
              cards: {
                minItems: number;
                maxItems: number;
                items: {
                  anyOf: {
                    properties: Record<
                      string,
                      { enum?: string[]; minLength?: number; items?: { minLength: number } }
                    >;
                  }[];
                };
              };
              trajectory: {
                properties: {
                  likelyPassageId: { minLength: number };
                  conditions: { minItems: number; items: { minLength: number } };
                  alternatePassageId: { minLength: number };
                };
              };
              userAgency: { minItems: number; items: { minLength: number } };
              reflectionQuestion: { minLength: number };
              disconfirmingEvidence: {
                minItems: number;
                items: { minLength: number };
              };
              uncertainty: { minLength: number };
            };
          };
        };
      };
    };
    const properties = request.response_format.json_schema.schema.properties;
    expect(properties.cards).toMatchObject({
      minItems: draw.assignments.length,
      maxItems: draw.assignments.length,
    });
    expect(properties.cards.items.anyOf).toHaveLength(draw.assignments.length);
    expect(
      properties.cards.items.anyOf.map(({ properties }) => ({
        positionId: properties.positionId!.enum![0],
        cardId: properties.cardId!.enum![0],
        orientation: properties.orientation!.enum![0],
      })),
    ).toEqual(
      draw.assignments.map(({ positionId, cardId, orientation }) => ({
        positionId,
        cardId,
        orientation,
      })),
    );
    expect(properties.title.minLength).toBe(1);
    expect(properties.passages.items.properties.id.minLength).toBe(1);
    expect(properties.passages.items.properties.text.minLength).toBe(1);
    for (const cardSchema of properties.cards.items.anyOf) {
      expect(cardSchema.properties.positionId!.minLength).toBe(1);
      expect(cardSchema.properties.cardId!.minLength).toBe(1);
      expect(cardSchema.properties.passageIds!.items!.minLength).toBe(1);
    }
    expect(properties.trajectory.properties.likelyPassageId.minLength).toBe(1);
    expect(properties.trajectory.properties.conditions.minItems).toBe(1);
    expect(properties.trajectory.properties.conditions.items.minLength).toBe(1);
    expect(properties.trajectory.properties.alternatePassageId.minLength).toBe(1);
    expect(properties.userAgency.minItems).toBe(1);
    expect(properties.userAgency.items.minLength).toBe(1);
    expect(properties.reflectionQuestion.minLength).toBe(1);
    expect(properties.disconfirmingEvidence.minItems).toBe(1);
    expect(properties.disconfirmingEvidence.items.minLength).toBe(1);
    expect(properties.uncertainty.minLength).toBe(1);
  });

  it.each([
    [
      "changed position ID",
      () => ({
        ...originalResult,
        cards: originalResult.cards.map((card, index) =>
          index === 0 ? { ...card, positionId: "invented-position" } : card,
        ),
      }),
    ],
    [
      "changed card ID",
      () => ({
        ...originalResult,
        cards: originalResult.cards.map((card, index) =>
          index === 0 ? { ...card, cardId: "major-00" } : card,
        ),
      }),
    ],
    [
      "changed orientation",
      () => ({
        ...originalResult,
        cards: originalResult.cards.map((card, index) =>
          index === 0 ? { ...card, orientation: "reversed" as const } : card,
        ),
      }),
    ],
    [
      "duplicate tuple",
      () => ({
        ...originalResult,
        cards: [originalResult.cards[0]!, originalResult.cards[0]!, originalResult.cards[2]!],
      }),
    ],
    ["missing tuple", () => ({ ...originalResult, cards: originalResult.cards.slice(0, -1) })],
    [
      "extra tuple",
      () => ({ ...originalResult, cards: [...originalResult.cards, originalResult.cards[0]!] }),
    ],
  ])("rejects a provider response with a %s", async (_label, makeResult) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(makeResult()) } }],
          }),
          { status: 200 },
        ),
      ),
    );

    const { result, provenance } = await provider().generateWithProvenance(input);
    expect(result.cards).toHaveLength(draw.assignments.length);
    expect(provenance.providerId).toBe("deterministic-fallback-v1:after-groq-invalid-response");
  });

  it("joins permuted model card threads to the exact locked position", async () => {
    const permuted = {
      ...originalResult,
      cards: [...originalResult.cards].reverse(),
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ choices: [{ message: { content: JSON.stringify(permuted) } }] }),
            { status: 200 },
          ),
        ),
    );

    const { result, provenance } = await provider().generateWithProvenance(input);
    expect(result.cards.map(({ positionId }) => positionId)).toEqual(
      spread.positions.map(({ id }) => id),
    );
    for (const [index, card] of result.cards.entries())
      expect(card.passageIds).toEqual(originalResult.cards[index]!.passageIds);
    expect(provenance.providerId).toBe("groq:test-model");
  });

  it("repairs unambiguous authored links without changing prose, lists, safety, or draw", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(repairableLinkResult) } }],
          }),
          {
            status: 200,
          },
        ),
      ),
    );

    const { result, provenance } = await provider().generateWithProvenance(input);
    expect(provenance.providerId).toBe("groq:test-model");
    expect(result).toEqual({
      ...repairableLinkResult,
      passages: repairableLinkResult.passages.map((passage) =>
        passage.id === "thread-1"
          ? { ...passage, cardReferences: [draw.assignments[0]!.positionId] }
          : { ...passage, cardReferences: [...passage.cardReferences] },
      ),
      cards: repairableLinkResult.cards.map((card, index) =>
        index === 0 ? { ...card, passageIds: ["thread-1"] } : card,
      ),
      trajectory: {
        ...repairableLinkResult.trajectory,
        likelyPassageId: "likely",
        alternatePassageId: "alternate",
      },
    });
  });

  it("rejects a card thread with no valid direct or reciprocal authored link", async () => {
    const irreparable = {
      ...originalResult,
      cards: originalResult.cards.map((card, index) =>
        index === 0 ? { ...card, passageIds: ["missing-passage"] } : card,
      ),
      passages: originalResult.passages.map((passage) => ({
        ...passage,
        cardReferences: passage.cardReferences.filter(
          (positionId) => positionId !== draw.assignments[0]!.positionId,
        ),
      })),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(irreparable) } }] }),
          {
            status: 200,
          },
        ),
      ),
    );

    const { provenance } = await provider().generateWithProvenance(input);
    expect(provenance.providerId).toBe("deterministic-fallback-v1:after-groq-invalid-response");
  });

  it("rejects duplicate passage IDs instead of guessing which passage a link meant", async () => {
    const ambiguous = {
      ...originalResult,
      passages: originalResult.passages.map((passage, index) =>
        index < 2 ? { ...passage, id: "duplicate" } : passage,
      ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(ambiguous) } }] }),
          {
            status: 200,
          },
        ),
      ),
    );

    const { provenance } = await provider().generateWithProvenance(input);
    expect(provenance.providerId).toBe("deterministic-fallback-v1:after-groq-invalid-response");
  });

  it.each(["missing", "ambiguous"])(
    "rejects a dangling trajectory link when its expected role is %s",
    async (kind) => {
      const originalTrajectory = originalResult.passages.find(({ role }) => role === "trajectory")!;
      const trajectoryPassages =
        kind === "missing"
          ? originalResult.passages.map((passage) =>
              passage.role === "trajectory"
                ? { ...passage, role: "development" as const }
                : passage,
            )
          : [...originalResult.passages, { ...originalTrajectory, id: "second-likely" }];
      const invalidTrajectory = {
        ...originalResult,
        passages: trajectoryPassages,
        trajectory: { ...originalResult.trajectory, likelyPassageId: "missing-likely" },
      };
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: JSON.stringify(invalidTrajectory) } }],
            }),
            { status: 200 },
          ),
        ),
      );

      const { provenance } = await provider().generateWithProvenance(input);
      expect(provenance.providerId).toBe("deterministic-fallback-v1:after-groq-invalid-response");
    },
  );

  it("still rejects unsafe prose after repairing metadata", async () => {
    const unsafeRepairable = {
      ...repairableLinkResult,
      passages: repairableLinkResult.passages.map((passage, index) =>
        index === 0 ? { ...passage, text: "You will get the job." } : passage,
      ),
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(unsafeRepairable) } }],
          }),
          { status: 200 },
        ),
      ),
    );

    const { provenance } = await provider().generateWithProvenance(input);
    expect(provenance.providerId).toBe("deterministic-fallback-v1:after-groq-unsafe-response");
  });

  it("uses low hidden reasoning for GPT-OSS without sending it to Llama", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify(originalResult) } }] }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    await fallbackProvider().generateWithProvenance(input);
    const requests = fetchMock.mock.calls.map(
      (call) =>
        JSON.parse(String(call[1]!.body)) as {
          model: string;
          reasoning_effort?: string;
          include_reasoning?: boolean;
        },
    );
    expect(requests[0]).toMatchObject({
      model: "openai/gpt-oss-120b",
      reasoning_effort: "low",
      include_reasoning: false,
    });
    expect(requests[1]).toEqual(
      expect.not.objectContaining({ reasoning_effort: expect.anything() }),
    );
    expect(requests[1]).toEqual(
      expect.not.objectContaining({ include_reasoning: expect.anything() }),
    );
  });
});

describe("a person always gets a reading (AI-015)", () => {
  it("falls back to the deterministic reader when the provider errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 500 })));
    const { result, provenance } = await provider().generateWithProvenance(input);
    expect(result.passages[0]?.text.length).toBeGreaterThan(0);
    expect(result.cards).toHaveLength(spread.positions.length);
    expect(provenance).toEqual({
      providerId: "deterministic-fallback-v1:after-groq-provider-unavailable",
      promptVersion: "deterministic-fallback-v3",
      schemaVersion: "reading-result-v2",
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

  it("uses the approved default chain and accepts an explicit de-duplicated override", () => {
    expect(configuredGroqModelChain()).toEqual([
      "openai/gpt-oss-120b",
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-20b",
    ]);

    vi.stubEnv("AI_PROVIDER_MODEL", "openai/gpt-oss-20b");
    vi.stubEnv(
      "AI_PROVIDER_FALLBACK_MODELS",
      "openai/gpt-oss-20b, llama-3.3-70b-versatile, openai/gpt-oss-120b",
    );
    expect(configuredGroqModelChain()).toEqual([
      "openai/gpt-oss-20b",
      "llama-3.3-70b-versatile",
      "openai/gpt-oss-120b",
    ]);
  });
});
