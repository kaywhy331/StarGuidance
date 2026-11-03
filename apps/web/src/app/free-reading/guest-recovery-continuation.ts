import type { ClientResult } from "@/lib/client-request";
import {
  GUEST_HANDOFF_PATTERN,
  GUEST_READING_HANDOFF_KEY,
  GUEST_READING_RECEIPT_KEY,
  guestReadingDisplaySchema,
  type GuestReadingDisplay,
} from "@/lib/guest-reading-contract";

export interface RecoveryStore {
  read(key: string): string | undefined;
  write(key: string, value: string | undefined): void;
}

/** The tab-scoped copy of a pending receipt (never a ceremony). */
export interface PendingReceiptStore {
  receipt(): string | undefined;
  clear(): void;
}

type PostContinue = (
  body: Record<string, string>,
) => Promise<ClientResult<Record<string, unknown>>>;

export type ContinuationOutcome =
  | {
      kind: "loaded";
      reading: GuestReadingDisplay;
      receipt: string;
      handoff?: string;
      savedReadingId?: string;
    }
  | { kind: "expired" }
  | { kind: "silent" }
  | { kind: "error"; message: string }
  | { kind: "aborted" };

// Only a server-confirmed expiry is definitive. Anything else (network, 5xx,
// auth, malformed) leaves the browser copy in place for another try.
const isExpired = (response: ClientResult<unknown>) =>
  !response.ok && response.status === 410 && response.data.expired === true;

// Remove a recovery key only if it still holds the value that was judged
// expired, so a newer receipt or handoff written meanwhile survives.
function clearIfUnchanged(store: RecoveryStore, key: string, judged: string) {
  if (store.read(key) === judged) store.write(key, undefined);
}

export async function resolveGuestContinuation(options: {
  preferHandoff: boolean;
  store: RecoveryStore;
  pending?: PendingReceiptStore;
  post: PostContinue;
  signal?: AbortSignal | undefined;
}): Promise<ContinuationOutcome> {
  const { preferHandoff, store, pending, post, signal } = options;
  // A handoff that just arrived from an email link names the reading the
  // visitor meant; an older receipt in this browser must not win.
  const storedReceipt = preferHandoff ? undefined : store.read(GUEST_READING_RECEIPT_KEY);
  const storedHandoff = store.read(GUEST_READING_HANDOFF_KEY);
  let receiptExpired = false;

  // Called only once the receipt is proven expired and its fallback is
  // exhausted. Each copy is removed only while it still holds that receipt.
  const clearExpiredReceipt = (judged: string) => {
    clearIfUnchanged(store, GUEST_READING_RECEIPT_KEY, judged);
    if (pending?.receipt() === judged) pending.clear();
  };

  if (storedReceipt) {
    const response = await post({ action: "recover", receipt: storedReceipt });
    if (signal?.aborted) return { kind: "aborted" };
    const parsed = response.ok
      ? guestReadingDisplaySchema.safeParse(response.data.reading)
      : undefined;
    if (parsed?.success) {
      const handoff = typeof response.data.handoff === "string" ? response.data.handoff : undefined;
      if (handoff) store.write(GUEST_READING_HANDOFF_KEY, handoff);
      return {
        kind: "loaded",
        reading: parsed.data,
        receipt: storedReceipt,
        ...(handoff ? { handoff } : {}),
        ...(typeof response.data.savedReadingId === "string"
          ? { savedReadingId: response.data.savedReadingId }
          : {}),
      };
    }
    receiptExpired = response.status === 410;
    const usableHandoff = Boolean(storedHandoff && GUEST_HANDOFF_PATTERN.test(storedHandoff));
    if (isExpired(response) && !usableHandoff) {
      clearExpiredReceipt(storedReceipt);
    }
    if (!storedHandoff) {
      if (receiptExpired) return { kind: "expired" };
      if (response.status === 401) return { kind: "silent" };
      return {
        kind: "error",
        message: response.ok ? "Your reading couldn’t be opened." : response.error,
      };
    }
    // The fallback decides the receipt's fate below: keep it while the
    // handoff might still recover the reading.
    if (isExpired(response) && usableHandoff) {
      const fallback = await redeem(storedHandoff as string);
      if (fallback.definitive) clearExpiredReceipt(storedReceipt);
      return fallback.outcome;
    }
  }

  if (storedHandoff && GUEST_HANDOFF_PATTERN.test(storedHandoff))
    return (await redeem(storedHandoff)).outcome;
  return receiptExpired ? { kind: "expired" } : { kind: "silent" };

  async function redeem(
    handoff: string,
  ): Promise<{ outcome: ContinuationOutcome; definitive: boolean }> {
    const response = await post({ action: "redeem", handoff });
    return {
      outcome: settle(handoff, response),
      definitive: !signal?.aborted && isExpired(response),
    };
  }

  function settle(
    handoff: string,
    response: ClientResult<Record<string, unknown>>,
  ): ContinuationOutcome {
    if (signal?.aborted) return { kind: "aborted" };
    const parsed = response.ok
      ? guestReadingDisplaySchema.safeParse(response.data.reading)
      : undefined;
    if (parsed?.success && typeof response.data.receipt === "string") {
      store.write(GUEST_READING_RECEIPT_KEY, response.data.receipt);
      return {
        kind: "loaded",
        reading: parsed.data,
        receipt: response.data.receipt,
        ...(typeof response.data.savedReadingId === "string"
          ? { savedReadingId: response.data.savedReadingId }
          : {}),
      };
    }
    if (response.status === 410) {
      if (isExpired(response)) clearIfUnchanged(store, GUEST_READING_HANDOFF_KEY, handoff);
      return { kind: "expired" };
    }
    return {
      kind: "error",
      message: response.ok ? "Your reading couldn’t be opened." : response.error,
    };
  }
}

/**
 * The receipts the anonymous free-reading page may recover from, in the order
 * to try them. The tab's pending copy goes first (it carries reveal progress),
 * but a different receipt kept in the browser may be newer — a handoff fallback
 * writes a fresh one there while the pending copy stays old — so it is tried
 * too rather than being erased along with the stale one.
 */
export function bootstrapReceiptCandidates(
  pendingReceipt: string | undefined,
  storedReceipt: string | undefined,
): string[] {
  return [
    ...new Set([pendingReceipt, storedReceipt].filter((value) => Boolean(value))),
  ] as string[];
}

/**
 * Forget a receipt the server confirmed expired. Only copies still holding that
 * exact receipt are removed; the handoff goes with the stored receipt it
 * belonged to, but survives when only a stale pending copy expired.
 */
export function forgetExpiredBootstrapReceipt(
  judged: string,
  store: RecoveryStore,
  pending: PendingReceiptStore,
) {
  if (store.read(GUEST_READING_RECEIPT_KEY) === judged) {
    store.write(GUEST_READING_RECEIPT_KEY, undefined);
    store.write(GUEST_READING_HANDOFF_KEY, undefined);
  }
  if (pending.receipt() === judged) pending.clear();
}
