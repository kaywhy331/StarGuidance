import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it, vi } from "vitest";
import {
  REVIEWED_GATEWAY_SYSTEM_PROMPTS,
  RUNTIME_PROMPT_BUNDLES,
  reviewedFollowUpResponseSchema,
  reviewedReadingResponseSchema,
} from "@starguidance/ai";
import { resolveSpreadPositions, spreads, tarotCards } from "@starguidance/tarot-content";

import {
  DEFAULT_ALLOWED_MODELS,
  FixedWindowBudgetLimiter,
  FixedWindowRateLimiter,
  canonicalCompletionResponse,
  canonicalInferencePayload,
  canonicalJwks,
  constantTimeEquals,
  conservativeTokenBudget,
  createAccessVerifier,
  validateInferencePayload,
} from "./security.mjs";

const spread = spreads.find(({ id }) => id === "three-card");
const questionContext = {
  version: "question-classification-v1",
  topic: "career",
  horizon: "open",
  intent: "decisionSupport",
  generalReading: false,
};
const positions = resolveSpreadPositions(spread, questionContext);
const configuration = {
  version: "reading-configuration-v1",
  reversalMode: "reversals_enabled",
  personalizationMode: "personalized_tarot",
  positions,
  capabilities: spread.capabilities,
};
const cards = positions.map((position, index) => {
  const card = tarotCards[index + 10];
  const orientation = index === 1 ? "reversed" : "upright";
  return {
    positionId: position.id,
    positionName: position.displayName,
    positionMeans: position.interpretiveFunction,
    positionDescription: position.description,
    cardId: card.id,
    card: card.name,
    arcana: card.arcana,
    orientation,
    themes: orientation === "upright" ? card.uprightThemes : card.reversedThemes,
    domainTags: card.eventTags,
    approvedReversalFacets: orientation === "reversed" ? card.reversalFacets : [],
  };
});
const readingPayload = {
  question: "Should I take the new role at work?",
  questionContext,
  spreadId: spread.id,
  spreadCapabilities: configuration.capabilities,
  trajectoryAllowed: configuration.capabilities.trajectoryPositionIds.length > 0,
  alternatePathAllowed: configuration.capabilities.alternativePositionGroups.length > 0,
  timingAllowed: configuration.capabilities.timingMethod !== null,
  personalizationAllowed: true,
  answerPositionId: cards[2].positionId,
  cards,
  readerLens: ["You commit quickly once a direction feels right."],
};
const originalReading = {
  directAnswer: "A deliberate step is taking shape.",
  overallPattern: "The challenge and direction ask for a measured decision.",
  cards: cards.map((card) => ({
    positionId: card.positionId,
    positionLabel: card.positionName,
    cardId: card.cardId,
    orientation: card.orientation,
    coreMeaning: card.themes[0],
    positionInterpretation: `${card.card} speaks through ${card.positionName}.`,
    relationshipNotes: [],
    supportingEvidence: [`${card.card} in ${card.positionName}`],
  })),
  synthesis: "Preparation may reveal the next opening.",
  likelyTrajectory: "The direction remains conditional on a workable structure.",
  alternatePath: null,
  userAgency: "Choose the next concrete milestone.",
};

function requestPayload(overrides = {}) {
  const userPayload = overrides.userPayload ?? readingPayload;
  const schemaName = overrides.schemaName ?? "reading";
  const schema =
    overrides.schema ??
    reviewedReadingResponseSchema(
      cards.map((entry) => ({
        position: { id: entry.positionId, displayName: entry.positionName },
        card: { id: entry.cardId },
        orientation: entry.orientation,
      })),
      configuration,
    );
  const model = overrides.model ?? "openai/gpt-oss-120b";
  return {
    model,
    temperature: 0.85,
    max_completion_tokens: 900,
    ...(model.startsWith("openai/gpt-oss-")
      ? { reasoning_effort: "low", include_reasoning: false }
      : {}),
    messages: [
      {
        role: "system",
        content: overrides.systemPrompt ?? REVIEWED_GATEWAY_SYSTEM_PROMPTS.reading,
      },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schemaName,
        strict: true,
        schema,
      },
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(
        ([key]) => !["userPayload", "schemaName", "schema", "systemPrompt"].includes(key),
      ),
    ),
  };
}

function encoded(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

describe("gateway security primitives", () => {
  it("uses a constant-time digest comparison without accepting missing values", () => {
    expect(constantTimeEquals("same", "same")).toBe(true);
    expect(constantTimeEquals("same", "different")).toBe(false);
    expect(constantTimeEquals(undefined, "same")).toBe(false);
  });

  it("accepts only the reviewed request fields, models, roles, schema, and reasoning policy", () => {
    expect(validateInferencePayload(Buffer.from(JSON.stringify(requestPayload()))).model).toBe(
      DEFAULT_ALLOWED_MODELS[0],
    );
    for (const payload of [
      requestPayload({ model: "unreviewed-model" }),
      requestPayload({ stream: true }),
      requestPayload({ tools: [{ type: "function" }] }),
      requestPayload({ max_completion_tokens: 2_601 }),
      requestPayload({ messages: [{ role: "user", content: "one" }] }),
      requestPayload({ systemPrompt: "Return JSON." }),
      requestPayload({ userPayload: { prompt: "arbitrary" } }),
      requestPayload({
        userPayload: { ...readingPayload, trajectoryAllowed: false },
      }),
      requestPayload({
        userPayload: { ...readingPayload, personalizationAllowed: false },
      }),
      requestPayload({
        userPayload: {
          ...readingPayload,
          cards: readingPayload.cards.map((card, index) =>
            index === 0 ? { ...card, card: "Invented card name" } : card,
          ),
        },
      }),
      requestPayload({
        userPayload: {
          ...readingPayload,
          cards: readingPayload.cards.map((card, index) =>
            index === 0 ? { ...card, approvedReversalFacets: ["negative"] } : card,
          ),
        },
      }),
      requestPayload({ response_format: { type: "json_schema", json_schema: { strict: true } } }),
      requestPayload({ schema: { type: "object" } }),
      requestPayload({ reasoning_effort: "high" }),
    ])
      expect(() => validateInferencePayload(Buffer.from(JSON.stringify(payload)))).toThrow();
  });

  it("accepts every concise grounded prompt through the reviewed boundary", () => {
    const grounded = RUNTIME_PROMPT_BUNDLES["reader-voice-v7-grounded"];
    for (const systemPrompt of [grounded.reading, grounded.guardedReading])
      expect(
        validateInferencePayload(Buffer.from(JSON.stringify(requestPayload({ systemPrompt }))))
          .model,
      ).toBe(DEFAULT_ALLOWED_MODELS[0]);

    const schema = reviewedFollowUpResponseSchema();
    const userPayload = {
      ...readingPayload,
      question: "What is the next concrete move?",
      originalReading,
    };
    for (const systemPrompt of [grounded.followUp, grounded.guardedFollowUp])
      expect(
        validateInferencePayload(
          Buffer.from(
            JSON.stringify(
              requestPayload({ userPayload, schemaName: "follow_up", schema, systemPrompt }),
            ),
          ),
        ).model,
      ).toBe(DEFAULT_ALLOWED_MODELS[0]);
  });

  it("accepts only the exact JSON-mode schema embedded after a reviewed prompt", () => {
    const schema = reviewedFollowUpResponseSchema();
    const userPayload = {
      ...readingPayload,
      question: "What is the next concrete move?",
      originalReading,
    };
    const valid = requestPayload({
      model: "llama-3.3-70b-versatile",
      userPayload,
      schemaName: "follow_up",
      schema,
      systemPrompt: `${REVIEWED_GATEWAY_SYSTEM_PROMPTS.followUp} Return only one JSON object matching this JSON Schema exactly: ${JSON.stringify(schema)}`,
      response_format: { type: "json_object" },
    });
    expect(validateInferencePayload(Buffer.from(JSON.stringify(valid))).model).toBe(
      "llama-3.3-70b-versatile",
    );
    expect(() =>
      validateInferencePayload(
        Buffer.from(
          JSON.stringify({
            ...valid,
            messages: [{ role: "system", content: "Return JSON." }, valid.messages[1]],
          }),
        ),
      ),
    ).toThrow("PROMPT_NOT_ALLOWED");
  });

  it("canonicalizes validated JSON so duplicate keys and whitespace do not cross the boundary", () => {
    const body = Buffer.from(
      JSON.stringify(requestPayload()).replace(
        '"temperature":0.85',
        '"temperature":0.2,"temperature":0.85',
      ),
    );
    const canonical = canonicalInferencePayload(body);
    expect(canonical.toString()).toBe(JSON.stringify(requestPayload()));
    expect(canonical.toString().match(/"temperature"/g)).toHaveLength(1);
  });

  it("rejects malformed completion and JWKS envelopes", () => {
    expect(() => canonicalCompletionResponse(Buffer.from("{}"))).toThrow(
      "INVALID_COMPLETION_RESPONSE",
    );
    expect(() => canonicalCompletionResponse(Buffer.from("not-json"))).toThrow(
      "INVALID_COMPLETION_RESPONSE",
    );
    expect(() =>
      canonicalCompletionResponse(
        Buffer.from(
          JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }),
        ),
      ),
    ).toThrow("INVALID_COMPLETION_RESPONSE");
    expect(
      JSON.parse(
        canonicalCompletionResponse(
          Buffer.from(
            JSON.stringify({
              id: "provider-id",
              usage: { prompt_tokens: 9 },
              choices: [
                {
                  finish_reason: "stop",
                  index: 0,
                  message: { role: "assistant", content: "{}", reasoning: "private" },
                },
              ],
            }),
          ),
        ).toString(),
      ),
    ).toEqual({ choices: [{ finish_reason: "stop", message: { content: "{}" } }] });
    expect(() => canonicalJwks(Buffer.from(JSON.stringify({ keys: [] })))).toThrow(
      "ACCESS_JWKS_INVALID",
    );
  });

  it("enforces per-identity request and conservative whole-request token windows", () => {
    let now = 0;
    const requests = new FixedWindowRateLimiter(2, 1_000, () => now);
    expect(requests.admit("subject").allowed).toBe(true);
    expect(requests.admit("subject").allowed).toBe(true);
    expect(requests.admit("subject").allowed).toBe(false);
    now = 1_001;
    expect(requests.admit("subject").allowed).toBe(true);

    const budget = new FixedWindowBudgetLimiter(1_000, 1_000, () => now);
    expect(budget.admit("subject", 600).allowed).toBe(true);
    expect(budget.admit("subject", 500).allowed).toBe(false);
    const request = Buffer.from(JSON.stringify(requestPayload()));
    expect(conservativeTokenBudget(request, requestPayload())).toBe(request.length + 900);

    const bounded = new FixedWindowBudgetLimiter(10, 1_000, () => now, 2);
    bounded.admit("one", 1);
    bounded.admit("two", 1);
    bounded.admit("three", 1);
    expect(bounded.buckets.size).toBe(2);
  });
});

describe("Cloudflare Access JWT verification", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = "synthetic-key";
  const issuer = "https://starguidance.cloudflareaccess.com";
  const audience = "synthetic-audience";
  const publicJwk = publicKey.export({ format: "jwk" });
  const jwks = { keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }] };

  function token(payloadOverrides = {}, headerOverrides = {}) {
    const header = encoded({ alg: "RS256", kid, typ: "JWT", ...headerOverrides });
    const payload = encoded({
      iss: issuer,
      aud: audience,
      sub: "service-token-subject",
      exp: 2_000,
      ...payloadOverrides,
    });
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey).toString(
      "base64url",
    );
    return `${header}.${payload}.${signature}`;
  }

  it("accepts one valid signed token and caches the reviewed key", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json(jwks));
    const verify = createAccessVerifier({
      teamDomain: issuer,
      audience,
      fetchImpl,
      now: () => 1_000_000,
    });
    await expect(verify(token())).resolves.toMatchObject({ subjectHash: expect.any(String) });
    await expect(verify(token())).resolves.toMatchObject({ subjectHash: expect.any(String) });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["missing", undefined],
    ["wrong issuer", token({ iss: "https://evil.cloudflareaccess.com" })],
    ["wrong audience", token({ aud: "wrong" })],
    ["expired", token({ exp: 999 })],
    ["wrong algorithm", token({}, { alg: "none" })],
  ])("rejects a %s Access assertion", async (_label, assertion) => {
    const verify = createAccessVerifier({
      teamDomain: issuer,
      audience,
      fetchImpl: vi.fn().mockResolvedValue(Response.json(jwks)),
      now: () => 1_000_000,
    });
    await expect(verify(assertion)).rejects.toThrow();
  });

  it("allows only the canonical team cert route or the exact internal relay", () => {
    expect(() =>
      createAccessVerifier({
        teamDomain: issuer,
        audience,
        jwksUrl: "http://169.254.169.254/certs",
      }),
    ).toThrow("CLOUDFLARE_ACCESS_JWKS_URL_INVALID");
    expect(() =>
      createAccessVerifier({
        teamDomain: "https://example.com",
        audience,
      }),
    ).toThrow("CLOUDFLARE_ACCESS_TEAM_DOMAIN_INVALID");
  });
});
