import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadingConfiguration } from "@starguidance/contracts";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw, type Spread } from "@starguidance/tarot-domain";

import { classifyQuestionContext, DeterministicFallbackProvider } from "../src";
import {
  classifyAiProviderBaseUrl,
  GroqInterpretationProvider,
  normalizedAiProviderBaseUrl,
  PROMPT_VERSION,
  REVIEWED_GATEWAY_SYSTEM_PROMPTS,
  RESPONSE_SCHEMA_VERSION,
  reviewedReadingResponseSchema,
} from "../src/groq-provider";
import { resolveDraw } from "../src/interpretation";

function selectedSpread(id = "one-card"): Spread {
  const value = spreads.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing spread ${id}`);
  return value;
}

function configuration(value: Spread, personalized = false): ReadingConfiguration {
  if (!value.capabilities) throw new Error("Spread capabilities are required");
  return {
    version: "reading-configuration-v1",
    reversalMode: "reversals_enabled",
    personalizationMode: personalized ? "personalized_tarot" : "pure_tarot",
    positions: value.positions,
    capabilities: value.capabilities,
  };
}

function generationInput(id = "one-card", personalized = false) {
  const spread = selectedSpread(id);
  const question = "What should I understand about my next practical step?";
  return {
    draw: createLockedDraw({
      cards: tarotCards,
      deckVersion: DECK_VERSION,
      spread,
      id: "00000000-0000-4000-8000-000000000002",
      now: new Date("2026-08-22T12:00:00.000Z"),
      random: () => 0,
    }),
    configuration: configuration(spread, personalized),
    question,
    questionClassification: classifyQuestionContext(question),
    relevantTraitStatements: ["the reader prefers reversible experiments"],
  };
}

function provider() {
  return new GroqInterpretationProvider({ apiKey: "test-key", model: "test-model" });
}

afterEach(() => vi.unstubAllGlobals());

describe("Groq transport boundaries", () => {
  it("allows direct Groq and rejects unsafe custom origins", () => {
    expect(normalizedAiProviderBaseUrl()).toBe("https://api.groq.com/openai/v1");
    expect(classifyAiProviderBaseUrl()).toBe("direct-groq");
    expect(classifyAiProviderBaseUrl("http://localhost:8787/v1")).toBe("invalid");
    expect(classifyAiProviderBaseUrl("https://127.0.0.1/v1")).toBe("invalid");
    expect(classifyAiProviderBaseUrl("https://gateway.example.com/v1")).toBe("access-gateway");
  });

  it("requires exact Access credentials and approved hostname for a gateway", () => {
    expect(
      () =>
        new GroqInterpretationProvider({
          apiKey: "secret",
          model: "model",
          baseUrl: "https://gateway.example.com/v1",
        }),
    ).toThrow("AI_PROVIDER_ACCESS_CREDENTIALS_INCOMPLETE");
    expect(
      new GroqInterpretationProvider({
        apiKey: "secret",
        model: "model",
        baseUrl: "https://gateway.example.com/v1",
        approvedGatewayHostname: "gateway.example.com",
        cloudflareAccessClientId: "id",
        cloudflareAccessClientSecret: "secret",
      }).id,
    ).toContain("groq-gateway");
  });
});

describe("provider payload and response contract", () => {
  it("uses the question-led consultation contract for new readings", () => {
    expect(PROMPT_VERSION).toBe("reader-voice-v6");
    expect(REVIEWED_GATEWAY_SYSTEM_PROMPTS.reading).toContain(
      "first sentence of directAnswer must answer",
    );
    expect(REVIEWED_GATEWAY_SYSTEM_PROMPTS.reading).toContain(
      "positionInterpretation is the lived reading",
    );
    expect(REVIEWED_GATEWAY_SYSTEM_PROMPTS.reading).toContain("Treat the spread like an argument");
  });

  it("omits all supplied traits in Pure Tarot", () => {
    const payload = provider().buildPayload(generationInput("one-card", false));
    expect(payload.personalizationAllowed).toBe(false);
    expect(payload.readerLens).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain("birthDate");
    expect(JSON.stringify(payload)).not.toContain("fullName");
  });

  it("sends only minimized statements in Personalized Tarot", () => {
    const payload = provider().buildPayload(generationInput("one-card", true));
    expect(payload.personalizationAllowed).toBe(true);
    expect(payload.readerLens).toEqual(["the reader prefers reversible experiments"]);
  });

  it("constrains unsupported one-card outlook sections to null", () => {
    const input = generationInput("one-card");
    const resolved = resolveDraw(
      input.draw,
      input.questionClassification,
      input.configuration.positions,
    );
    const schema = reviewedReadingResponseSchema(resolved, input.configuration) as {
      properties: Record<string, { type?: string }>;
    };
    expect(schema.properties.likelyTrajectory?.type).toBe("null");
    expect(schema.properties.alternatePath?.type).toBe("null");
    expect(schema.properties.timing?.type).toBe("null");
    expect(schema.properties.personalizationLens?.type).toBe("null");
  });

  it("falls back on an invalid provider response without changing the locked draw", async () => {
    const input = generationInput("three-card");
    const assignments = input.draw.assignments.map((assignment) => ({ ...assignment }));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const generated = await provider().generateWithProvenance(input);
    expect(generated.provenance.providerId).toContain(
      "deterministic-fallback-v1:after-groq-invalid-response",
    );
    expect(
      generated.result.cards.map(({ positionId, cardId, orientation }) => ({
        positionId,
        cardId,
        orientation,
      })),
    ).toEqual(
      assignments.map(({ positionId, cardId, orientation }) => ({
        positionId,
        cardId,
        orientation,
      })),
    );
  });

  it("accepts a v3 provider result only when every locked tuple is echoed", async () => {
    const input = generationInput("one-card");
    const expected = await new DeterministicFallbackProvider().generate(input);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ finish_reason: "stop", message: { content: JSON.stringify(expected) } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const generated = await provider().generateWithProvenance(input);
    expect(generated.provenance).toMatchObject({
      providerId: "groq:test-model",
      promptVersion: PROMPT_VERSION,
      schemaVersion: RESPONSE_SCHEMA_VERSION,
    });
    expect(generated.result.cards[0]).toMatchObject({
      positionId: input.draw.assignments[0]?.positionId,
      cardId: input.draw.assignments[0]?.cardId,
      orientation: input.draw.assignments[0]?.orientation,
    });
  });

  it("rejects a model-manufactured alternate path and falls back for Focus", async () => {
    const input = generationInput("one-card");
    const invalid = {
      ...(await new DeterministicFallbackProvider().generate(input)),
      alternatePath: "A path the spread does not define.",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              choices: [{ finish_reason: "stop", message: { content: JSON.stringify(invalid) } }],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const generated = await provider().generateWithProvenance(input);
    expect(generated.result.alternatePath).toBeNull();
    expect(generated.provenance.providerId).toContain("deterministic-fallback");
  });
});
