import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { classifyQuestionContext, DeterministicFallbackProvider } from "@starguidance/ai";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";

import type { ClientResult } from "@/lib/client-request";
import { GUEST_READING_HANDOFF_KEY, GUEST_READING_RECEIPT_KEY } from "@/lib/guest-reading-contract";
import { guestReadingDisplay } from "@/lib/guest-reading-server";
import { issueGuestReadingReceipt, verifyGuestReadingReceipt } from "@/lib/guest-reading-security";

import {
  bootstrapReceiptCandidates,
  forgetExpiredBootstrapReceipt,
  resolveGuestContinuation,
  type PendingReceiptStore,
  type RecoveryStore,
} from "./guest-recovery-continuation";

const HANDOFF = `h1.${"a".repeat(16)}.payload.${"b".repeat(22)}`;
const NEWER_HANDOFF = `h1.${"c".repeat(16)}.payload.${"d".repeat(22)}`;
const TRIAL_KEY = "sg:guest-trial-used:v1";

type Result = ClientResult<Record<string, unknown>>;
type Pending = { kind: "receipt"; receipt: string } | { kind: "ceremony" } | undefined;

// A real, schema-valid display built from the production receipt/display code.
let reading: unknown;

beforeAll(async () => {
  vi.stubEnv("APP_ENV", "test");
  vi.stubEnv("GUEST_TRIAL_SECRET", Buffer.alloc(32, 29).toString("base64"));
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
  const { receipt } = issueGuestReadingReceipt({
    readingId: draw.id,
    question,
    questionClassification,
    configuration,
    readerLens: [],
    draw,
    result,
    createdAt: new Date().toISOString(),
  });
  reading = guestReadingDisplay(verifyGuestReadingReceipt(receipt)!);
});

afterAll(() => vi.unstubAllEnvs());

const expired: Result = {
  ok: false,
  status: 410,
  error: "Your saved guest reading expired after 7 days.",
  data: { expired: true },
};
// A 410 that does not carry the server's explicit expiry flag.
const uncertainGone: Result = { ok: false, status: 410, error: "Gone.", data: {} };
const transient = (status: number): Result => ({
  ok: false,
  status,
  error: "Try again.",
  data: {},
});
const loaded = (data: Record<string, unknown>): Result => ({
  ok: true,
  status: 200,
  data: { reading, ...data },
});

interface Harness {
  values: Map<string, string>;
  session: { current: Pending };
}

function run(
  initial: Record<string, string>,
  responses: Result[],
  options: {
    preferHandoff?: boolean;
    session?: Pending;
    signal?: AbortSignal;
    // Runs inside each request, to simulate state changing while it is in flight.
    onPost?: (harness: Harness, call: number) => void;
  } = {},
) {
  const values = new Map(Object.entries(initial));
  const session: Harness["session"] = { current: options.session };
  const store: RecoveryStore = {
    read: (key) => values.get(key),
    write: (key, value) => {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
    },
  };
  const pending: PendingReceiptStore = {
    receipt: () => (session.current?.kind === "receipt" ? session.current.receipt : undefined),
    clear: () => {
      session.current = undefined;
    },
  };
  const calls: Record<string, string>[] = [];
  const outcome = resolveGuestContinuation({
    preferHandoff: options.preferHandoff ?? false,
    store,
    pending,
    signal: options.signal,
    post: async (body) => {
      calls.push(body);
      options.onPost?.({ values, session }, calls.length);
      const next = responses.shift();
      if (!next) throw new Error("unexpected request");
      return next;
    },
  });
  return { outcome, values, session, calls };
}

describe("resolveGuestContinuation expiry cleanup", () => {
  it("clears an expired receipt and its pending copy, keeping the trial marker", async () => {
    const { outcome, values, session } = run(
      { [GUEST_READING_RECEIPT_KEY]: "r-old", [TRIAL_KEY]: "1" },
      [expired],
      { session: { kind: "receipt", receipt: "r-old" } },
    );
    expect(await outcome).toEqual({ kind: "expired" });
    expect(values.has(GUEST_READING_RECEIPT_KEY)).toBe(false);
    expect(session.current).toBeUndefined();
    expect(values.get(TRIAL_KEY)).toBe("1");
  });

  it("clears both artifacts and the pending copy once the handoff is also expired", async () => {
    const { outcome, values, session, calls } = run(
      { [GUEST_READING_RECEIPT_KEY]: "r-old", [GUEST_READING_HANDOFF_KEY]: HANDOFF },
      [expired, expired],
      { session: { kind: "receipt", receipt: "r-old" } },
    );
    expect(await outcome).toEqual({ kind: "expired" });
    expect(calls.map((call) => call.action)).toEqual(["recover", "redeem"]);
    expect(values.size).toBe(0);
    expect(session.current).toBeUndefined();
  });

  it("keeps every artifact when an expired receipt's fallback is a non-definitive 410", async () => {
    const { outcome, values, session } = run(
      { [GUEST_READING_RECEIPT_KEY]: "r-old", [GUEST_READING_HANDOFF_KEY]: HANDOFF },
      [expired, uncertainGone],
      { session: { kind: "receipt", receipt: "r-old" } },
    );
    expect(await outcome).toEqual({ kind: "expired" });
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("r-old");
    expect(values.get(GUEST_READING_HANDOFF_KEY)).toBe(HANDOFF);
    expect(session.current).toEqual({ kind: "receipt", receipt: "r-old" });
  });

  it("keeps everything when the fallback is aborted after an expired receipt", async () => {
    const controller = new AbortController();
    const { outcome, values, session } = run(
      { [GUEST_READING_RECEIPT_KEY]: "r-old", [GUEST_READING_HANDOFF_KEY]: HANDOFF },
      [expired, expired],
      {
        signal: controller.signal,
        session: { kind: "receipt", receipt: "r-old" },
        onPost: (_harness, call) => {
          if (call === 2) controller.abort();
        },
      },
    );
    expect(await outcome).toEqual({ kind: "aborted" });
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("r-old");
    expect(values.get(GUEST_READING_HANDOFF_KEY)).toBe(HANDOFF);
    expect(session.current).toEqual({ kind: "receipt", receipt: "r-old" });
  });

  it("keeps the viable fallback and replaces the receipt when the handoff redeems", async () => {
    const { outcome, values, session } = run(
      { [GUEST_READING_RECEIPT_KEY]: "r-old", [GUEST_READING_HANDOFF_KEY]: HANDOFF },
      [expired, loaded({ receipt: "r-new", savedReadingId: "saved-1" })],
      { session: { kind: "receipt", receipt: "r-old" } },
    );
    expect(await outcome).toMatchObject({
      kind: "loaded",
      receipt: "r-new",
      savedReadingId: "saved-1",
    });
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("r-new");
    expect(values.get(GUEST_READING_HANDOFF_KEY)).toBe(HANDOFF);
    expect(session.current).toEqual({ kind: "receipt", receipt: "r-old" });
  });

  it("preserves everything when the fallback fails transiently after an expired receipt", async () => {
    const { outcome, values, session } = run(
      { [GUEST_READING_RECEIPT_KEY]: "r-old", [GUEST_READING_HANDOFF_KEY]: HANDOFF },
      [expired, transient(503)],
      { session: { kind: "receipt", receipt: "r-old" } },
    );
    expect(await outcome).toMatchObject({ kind: "error" });
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("r-old");
    expect(values.get(GUEST_READING_HANDOFF_KEY)).toBe(HANDOFF);
    expect(session.current).toEqual({ kind: "receipt", receipt: "r-old" });
  });

  it.each([503, 401, 0])("preserves a valid receipt on a %i failure", async (status) => {
    const { outcome, values, session } = run(
      { [GUEST_READING_RECEIPT_KEY]: "r-ok" },
      [transient(status)],
      { session: { kind: "receipt", receipt: "r-ok" } },
    );
    expect((await outcome).kind).toBe(status === 401 ? "silent" : "error");
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("r-ok");
    expect(session.current).toEqual({ kind: "receipt", receipt: "r-ok" });
  });

  it("does not clear on a 410 without the expiry flag", async () => {
    const { outcome, values, session } = run(
      { [GUEST_READING_RECEIPT_KEY]: "r-x" },
      [uncertainGone],
      {
        session: { kind: "receipt", receipt: "r-x" },
      },
    );
    expect(await outcome).toEqual({ kind: "expired" });
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("r-x");
    expect(session.current).toEqual({ kind: "receipt", receipt: "r-x" });
  });

  it("clears only the handoff when the email handoff expires and the older receipt was not tried", async () => {
    const { outcome, values, session } = run(
      { [GUEST_READING_RECEIPT_KEY]: "r-other", [GUEST_READING_HANDOFF_KEY]: HANDOFF },
      [expired],
      { preferHandoff: true, session: { kind: "receipt", receipt: "r-other" } },
    );
    expect(await outcome).toEqual({ kind: "expired" });
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("r-other");
    expect(values.has(GUEST_READING_HANDOFF_KEY)).toBe(false);
    expect(session.current).toEqual({ kind: "receipt", receipt: "r-other" });
  });

  it("keeps a valid receipt and stores a refreshed handoff", async () => {
    const { outcome, values } = run({ [GUEST_READING_RECEIPT_KEY]: "r-ok" }, [
      loaded({ handoff: HANDOFF }),
    ]);
    expect(await outcome).toMatchObject({ kind: "loaded", receipt: "r-ok", handoff: HANDOFF });
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("r-ok");
    expect(values.get(GUEST_READING_HANDOFF_KEY)).toBe(HANDOFF);
  });

  it("leaves a pending ceremony alone when the receipt expires", async () => {
    const { outcome, values, session } = run({ [GUEST_READING_RECEIPT_KEY]: "r-old" }, [expired], {
      session: { kind: "ceremony" },
    });
    expect(await outcome).toEqual({ kind: "expired" });
    expect(values.has(GUEST_READING_RECEIPT_KEY)).toBe(false);
    expect(session.current).toEqual({ kind: "ceremony" });
  });

  it("leaves a different pending receipt alone", async () => {
    const { outcome, session } = run({ [GUEST_READING_RECEIPT_KEY]: "r-old" }, [expired], {
      session: { kind: "receipt", receipt: "r-unrelated" },
    });
    expect(await outcome).toEqual({ kind: "expired" });
    expect(session.current).toEqual({ kind: "receipt", receipt: "r-unrelated" });
  });

  it("does not erase newer artifacts written while the expired requests were in flight", async () => {
    const { outcome, values, session } = run(
      { [GUEST_READING_RECEIPT_KEY]: "r-old", [GUEST_READING_HANDOFF_KEY]: HANDOFF },
      [expired, expired],
      {
        session: { kind: "receipt", receipt: "r-old" },
        onPost: ({ values: live, session: liveSession }) => {
          live.set(GUEST_READING_RECEIPT_KEY, "r-newer");
          live.set(GUEST_READING_HANDOFF_KEY, NEWER_HANDOFF);
          liveSession.current = { kind: "receipt", receipt: "r-newer" };
        },
      },
    );
    expect(await outcome).toEqual({ kind: "expired" });
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("r-newer");
    expect(values.get(GUEST_READING_HANDOFF_KEY)).toBe(NEWER_HANDOFF);
    expect(session.current).toEqual({ kind: "receipt", receipt: "r-newer" });
  });

  it("changes nothing when the first request was aborted", async () => {
    const controller = new AbortController();
    const { outcome, values, session } = run({ [GUEST_READING_RECEIPT_KEY]: "r-old" }, [expired], {
      signal: controller.signal,
      session: { kind: "receipt", receipt: "r-old" },
      onPost: () => controller.abort(),
    });
    expect(await outcome).toEqual({ kind: "aborted" });
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("r-old");
    expect(session.current).toEqual({ kind: "receipt", receipt: "r-old" });
  });
});

describe("bootstrap receipt candidates and expiry cleanup", () => {
  const harness = (stored: Record<string, string>, pendingReceipt?: string) => {
    const values = new Map(Object.entries(stored));
    const session = { current: pendingReceipt };
    const store: RecoveryStore = {
      read: (key) => values.get(key),
      write: (key, value) => {
        if (value === undefined) values.delete(key);
        else values.set(key, value);
      },
    };
    const pending: PendingReceiptStore = {
      receipt: () => session.current,
      clear: () => {
        session.current = undefined;
      },
    };
    return { values, session, store, pending };
  };

  it("tries the pending receipt first, then a different stored one, once each", () => {
    expect(bootstrapReceiptCandidates("old", "new")).toEqual(["old", "new"]);
    expect(bootstrapReceiptCandidates("same", "same")).toEqual(["same"]);
    expect(bootstrapReceiptCandidates(undefined, "new")).toEqual(["new"]);
    expect(bootstrapReceiptCandidates("old", undefined)).toEqual(["old"]);
    expect(bootstrapReceiptCandidates(undefined, undefined)).toEqual([]);
  });

  it("keeps a newer stored receipt and its handoff when only a stale pending receipt expired", () => {
    const { values, session, store, pending } = harness(
      { [GUEST_READING_RECEIPT_KEY]: "newer", [GUEST_READING_HANDOFF_KEY]: HANDOFF },
      "older",
    );
    forgetExpiredBootstrapReceipt("older", store, pending);
    expect(session.current).toBeUndefined();
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("newer");
    expect(values.get(GUEST_READING_HANDOFF_KEY)).toBe(HANDOFF);
  });

  it("keeps a newer pending receipt when the stored receipt expired", () => {
    const { values, session, store, pending } = harness(
      { [GUEST_READING_RECEIPT_KEY]: "older", [GUEST_READING_HANDOFF_KEY]: HANDOFF },
      "newer",
    );
    forgetExpiredBootstrapReceipt("older", store, pending);
    expect(session.current).toBe("newer");
    expect(values.has(GUEST_READING_RECEIPT_KEY)).toBe(false);
    expect(values.has(GUEST_READING_HANDOFF_KEY)).toBe(false);
  });

  it("clears every copy of the one expired receipt and leaves unrelated keys alone", () => {
    const { values, session, store, pending } = harness(
      {
        [GUEST_READING_RECEIPT_KEY]: "gone",
        [GUEST_READING_HANDOFF_KEY]: HANDOFF,
        [TRIAL_KEY]: "1",
      },
      "gone",
    );
    forgetExpiredBootstrapReceipt("gone", store, pending);
    expect(session.current).toBeUndefined();
    expect([...values.keys()]).toEqual([TRIAL_KEY]);
  });

  it("keeps a transiently failed pending receipt when a different receipt was recovered", () => {
    const { values, session, store, pending } = harness(
      { [GUEST_READING_RECEIPT_KEY]: "refreshed" },
      "pendingReceipt",
    );
    // Only a server-confirmed expiry of that exact receipt may clear it.
    forgetExpiredBootstrapReceipt("unrelated", store, pending);
    expect(session.current).toBe("pendingReceipt");
    expect(values.get(GUEST_READING_RECEIPT_KEY)).toBe("refreshed");
  });
});
