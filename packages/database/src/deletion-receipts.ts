import { createHash } from "node:crypto";

import type { DatabaseTransaction } from "./postgres-client";

/**
 * Domain-separated hash of the deleted subject. Deterministic on purpose:
 * given a user id (from a dispute, a data-subject request, a Stripe event
 * that outlived the account), an operator can recompute the hash and answer
 * "was this subject deleted, when, and under which policy version" — while
 * the receipt row itself retains no identifier a cascade or an export could
 * ever surface.
 */
export function deletionReceiptSubjectHash(userId: string): string {
  return createHash("sha256").update(`starguidance-deletion-receipt-v1:${userId}`).digest("hex");
}

/**
 * Appends the tombstone (migration 0010). Call inside the requesting user's
 * actor transaction, after re-authentication succeeds and BEFORE the Auth
 * identity is deleted: the receipt records an authorized deletion request, so
 * a failure to write it must abort the deletion (fail closed), never the
 * reverse — an unrecorded erasure is exactly what this table exists to
 * prevent.
 */
export async function recordDeletionReceipt(
  tx: DatabaseTransaction,
  input: { userId: string; policyVersion: string },
): Promise<void> {
  await tx`
    insert into deletion_receipts (subject_hash, policy_version)
    values (${deletionReceiptSubjectHash(input.userId)}, ${input.policyVersion})
  `;
}
