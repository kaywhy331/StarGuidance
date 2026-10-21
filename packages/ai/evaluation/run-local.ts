import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { followUpResultSchema, readingResultV3Schema } from "@starguidance/contracts";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";
import {
  classifyQuestion,
  classifyQuestionContext,
  DeterministicFallbackProvider,
  FALLBACK_PROMPT_VERSION,
  type ReadingGenerationInput,
} from "../src";
import { GroqInterpretationProvider, PROMPT_VERSION } from "../src/groq-provider";
import {
  EVALUATION_VERSION,
  evaluatedSpreads,
  outputCases,
  questionCases,
  reflectionQuestions,
} from "./corpus";

export function evaluationInput(
  spreadId = "three-card",
  question: string = reflectionQuestions[0][1],
): ReadingGenerationInput {
  const spread = spreads.find(({ id }) => id === spreadId);
  if (!spread?.capabilities) throw new Error(`Missing spread ${spreadId}`);
  return {
    draw: createLockedDraw({
      cards: tarotCards,
      deckVersion: DECK_VERSION,
      spread,
      id: "00000000-0000-4000-8000-000000000006",
      now: new Date("2026-10-15T00:00:00.000Z"),
      random: () => 0,
    }),
    configuration: {
      version: "reading-configuration-v1",
      reversalMode: "reversals_enabled",
      personalizationMode: "personalized_tarot",
      positions: spread.positions,
      capabilities: spread.capabilities,
    },
    question,
    questionClassification: classifyQuestionContext(question),
    relevantTraitStatements: ["You prefer small reversible experiments before a major commitment."],
  };
}

type Row = { id: string; criterion: string; passed: boolean; observed: string };
const tuples = (cards: readonly { cardId: string; positionId: string; orientation: string }[]) =>
  cards.map(({ cardId, positionId, orientation }) => ({ cardId, positionId, orientation }));
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const envelope = (value: unknown) =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }],
    }),
    { status: 200 },
  );

/** No credentials or environment-selected adapters. Every fetch is replaced before construction. */
export async function evaluateLocally() {
  const rows: Row[] = [];
  const originalFetch = globalThis.fetch;
  let responder: (init?: RequestInit) => Promise<Response> = async () => {
    throw new Error("UNEXPECTED_MOCK_FETCH");
  };
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    return responder(init);
  };
  try {
    const fallback = new DeterministicFallbackProvider();
    const provider = new GroqInterpretationProvider({
      apiKey: "synthetic-not-a-credential",
      model: "mock-primary",
      fallbackModels: ["mock-secondary"],
      timeoutMs: 50,
      totalTimeoutMs: 500,
    });
    for (const test of questionCases) {
      const observed = classifyQuestion(test.question);
      rows.push({
        id: test.id,
        criterion: "input-safety",
        passed: observed.category === test.category && observed.interrupt === test.interrupt,
        observed: `${observed.category}; interrupt=${observed.interrupt}`,
      });
      // The classifier gate is evaluated here, not the UI crisis-resource experience.
    }
    for (const spread of evaluatedSpreads)
      for (const [domain, question] of reflectionQuestions) {
        const input = evaluationInput(spread, question);
        const before = structuredClone(input);
        const result = await fallback.generate(input);
        const retry = await fallback.generate(input);
        const followUp = await fallback.generateFollowUp({
          ...input,
          question: "What is one practical first step?",
          originalResult: result,
        });
        rows.push({
          id: `R-${spread}-${domain}`,
          criterion: "fallback-schema-and-locked-draw",
          passed:
            readingResultV3Schema.safeParse(result).success &&
            followUpResultSchema.safeParse(followUp).success &&
            same(tuples(result.cards), tuples(input.draw.assignments)) &&
            same(result, retry) &&
            same(input, before) &&
            result.userAgency.length > 0 &&
            result.uncertaintyNote.length > 0,
          observed:
            "schema, exact card tuples, repeat equality, input immutability, agency/uncertainty presence; semantic quality unscored",
        });
      }
    const input = evaluationInput();
    const before = structuredClone(input);
    const good = await fallback.generate(input);
    const followUpInput = {
      ...input,
      question: "What is one practical first step?",
      originalResult: good,
    };
    const goodFollowUp = await fallback.generateFollowUp(followUpInput);
    for (const test of outputCases) {
      responder = async () => envelope({ ...good, directAnswer: test.text });
      const reading = await provider.generateWithProvenance(input);
      const rejected = reading.provenance.providerId.startsWith("deterministic-fallback");
      rows.push({
        id: `${test.id}-reading`,
        criterion: test.criterion,
        passed:
          rejected === test.reject &&
          same(tuples(reading.result.cards), tuples(input.draw.assignments)) &&
          same(input, before),
        observed: reading.provenance.providerId,
      });
      responder = async () => envelope({ ...goodFollowUp, response: test.text });
      const followUp = await provider.generateFollowUpWithProvenance(followUpInput);
      rows.push({
        id: `${test.id}-follow-up`,
        criterion: test.criterion,
        passed:
          followUp.provenance.providerId.startsWith("deterministic-fallback") === test.reject &&
          same(input, before),
        observed: followUp.provenance.providerId,
      });
    }
    const failures: readonly [string, string, (init?: RequestInit) => Promise<Response>, number][] =
      [
        ["F01-auth", "authentication", async () => new Response("synthetic", { status: 401 }), 1],
        ["F02-limit", "rate-limited", async () => new Response("synthetic", { status: 429 }), 2],
        [
          "F03-unavailable",
          "provider-unavailable",
          async () => new Response("synthetic", { status: 503 }),
          2,
        ],
        [
          "F04-network",
          "network-error",
          async () => {
            throw new TypeError("synthetic");
          },
          2,
        ],
        [
          "F05-timeout",
          "request-timeout",
          (init) =>
            new Promise<Response>((_resolve, reject) => {
              if (!init?.signal) {
                reject(new Error("MISSING_TIMEOUT_SIGNAL"));
                return;
              }
              init.signal.addEventListener(
                "abort",
                () => reject(new DOMException("synthetic", "AbortError")),
                { once: true },
              );
            }),
          2,
        ],
        ["F06-json", "invalid-response", async () => new Response("not-json"), 2],
        ["F07-schema", "invalid-response", async () => envelope({}), 2],
        [
          "F08-draw",
          "invalid-response",
          async () =>
            envelope({
              ...good,
              cards: good.cards.map((card) => ({ ...card, cardId: "invented-card" })),
            }),
          2,
        ],
      ];
    for (const [id, reason, response, expectedCalls] of failures) {
      responder = response;
      const start = calls;
      const result = await provider.generateWithProvenance(input);
      rows.push({
        id,
        criterion: "provider-failure-same-draw",
        passed:
          result.provenance.providerId === `deterministic-fallback-v1:after-groq-${reason}` &&
          calls - start === expectedCalls &&
          same(result.result, good) &&
          same(input, before),
        observed: `${result.provenance.providerId}; attempts=${calls - start}`,
      });
    }
    return {
      evaluationVersion: EVALUATION_VERSION,
      corpusSha256: createHash("sha256")
        .update(
          JSON.stringify({ questionCases, outputCases, reflectionQuestions, evaluatedSpreads }),
        )
        .digest("hex"),
      mode: "mock-local-only",
      liveProviderCalls: 0,
      mockFetchCalls: calls,
      versions: { prompt: PROMPT_VERSION, fallback: FALLBACK_PROMPT_VERSION, deck: DECK_VERSION },
      qualification: "NOT_QUALIFIED: bounded synthetic checks; expert and semantic review unscored",
      summary: {
        total: rows.length,
        passed: rows.filter((row) => row.passed).length,
        failed: rows.filter((row) => !row.passed).length,
      },
      rows,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await evaluateLocally();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.summary.failed > 0) process.exitCode = 1;
}
