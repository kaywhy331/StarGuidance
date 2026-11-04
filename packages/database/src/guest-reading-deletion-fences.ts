import { createHash } from "node:crypto";

/**
 * Opaque fence for a saved guest reading that was deleted from history
 * (migration 0030). A guest receipt is a stateless bearer artifact, valid for
 * seven days and byte-identical before and after the deletion, so without a
 * fence the server cannot tell a delayed or replayed save from a new one. The
 * fence keeps only this domain-separated digest of the reading id and the
 * receipt's own expiry: no owner, no content, no other timestamp. Once the
 * receipt has expired it can no longer be redeemed, so the fence is pruned.
 */
export function guestReadingDeletionFence(readingId: string): string {
  return createHash("sha256")
    .update(`starguidance-guest-reading-deletion-v1:${readingId}`)
    .digest("hex");
}
