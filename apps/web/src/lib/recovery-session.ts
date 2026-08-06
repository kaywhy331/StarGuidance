import "server-only";

import { z } from "zod";
import { decryptSensitiveWithKeys, encryptSensitive } from "@starguidance/database";

import { getDecryptionKeys, getEncryptionKey } from "./runtime";

export const RECOVERY_SESSION_COOKIE = "starguidance_password_recovery";
export const RECOVERY_SESSION_TTL_SECONDS = 15 * 60;

const receiptSchema = z.object({
  purpose: z.literal("password-recovery"),
  userId: z.string().uuid(),
  expiresAt: z.number().int().positive(),
});

export function issueRecoveryReceipt(userId: string, now = Date.now()): string {
  return encryptSensitive(
    JSON.stringify({
      purpose: "password-recovery",
      userId,
      expiresAt: now + RECOVERY_SESSION_TTL_SECONDS * 1000,
    }),
    getEncryptionKey(),
  );
}

export function verifyRecoveryReceipt(
  value: string | undefined,
  userId: string,
  now = Date.now(),
): boolean {
  if (!value) return false;
  try {
    const receipt = receiptSchema.parse(
      JSON.parse(decryptSensitiveWithKeys(value, getDecryptionKeys())),
    );
    return receipt.userId === userId && receipt.expiresAt >= now;
  } catch {
    return false;
  }
}
