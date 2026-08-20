import type { StoredReading } from "@starguidance/database";
import type { ReadingEntitlementDecision } from "@starguidance/contracts";

const DEFAULT_FOLLOW_UP_LIMIT = 1;
const DEFAULT_REREAD_COOLDOWN_MINUTES = 30;
const DEFAULT_FREE_ALLOWANCE = 3;
const DEFAULT_ALLOWANCE_WINDOW_HOURS = 24;
const DEFAULT_SESSION_TTL_MINUTES = 24 * 60;

export interface ReadingPolicyOverrides {
  readingAccessMode?: "unlimited" | "free-window";
  freeAllowance?: number;
  allowanceWindowHours?: number;
  followUpLimit?: number;
  rereadCooldownMinutes?: number;
}

function integerPolicy(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function followUpLimit(overrides?: ReadingPolicyOverrides): number {
  return (
    overrides?.followUpLimit ??
    integerPolicy("READING_FOLLOW_UP_LIMIT", DEFAULT_FOLLOW_UP_LIMIT, 0, 10)
  );
}

export function rereadCooldownMs(overrides?: ReadingPolicyOverrides): number {
  return (
    (overrides?.rereadCooldownMinutes ??
      integerPolicy(
        "READING_REREAD_COOLDOWN_MINUTES",
        DEFAULT_REREAD_COOLDOWN_MINUTES,
        0,
        24 * 60,
      )) * 60_000
  );
}

export function readingEntitlementDecision(
  readings: readonly Pick<StoredReading, "createdAt">[],
  now = Date.now(),
  overrides?: ReadingPolicyOverrides,
): ReadingEntitlementDecision {
  const mode =
    overrides?.readingAccessMode ??
    (process.env.READING_ACCESS_MODE === "free-window" ? "free-window" : "unlimited");
  if (mode === "unlimited")
    return {
      version: "reading-entitlement-v1",
      mode,
      outcome: "granted",
      entitlementClass: "standard",
      used: readings.length,
      limit: null,
      remaining: null,
      windowStartsAt: null,
      windowEndsAt: null,
    };

  const limit =
    overrides?.freeAllowance ??
    integerPolicy("READING_FREE_ALLOWANCE", DEFAULT_FREE_ALLOWANCE, 1, 100);
  const windowHours =
    overrides?.allowanceWindowHours ??
    integerPolicy("READING_ALLOWANCE_WINDOW_HOURS", DEFAULT_ALLOWANCE_WINDOW_HOURS, 1, 24 * 30);
  const windowMs = windowHours * 60 * 60_000;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const windowEnd = windowStart + windowMs;
  const used = readings.filter(({ createdAt }) => {
    const created = Date.parse(createdAt);
    return Number.isFinite(created) && created >= windowStart && created < windowEnd;
  }).length;
  return {
    version: "reading-entitlement-v1",
    mode,
    outcome: used < limit ? "granted" : "limitReached",
    entitlementClass: "standard",
    used,
    limit,
    remaining: Math.max(0, limit - used),
    windowStartsAt: new Date(windowStart).toISOString(),
    windowEndsAt: new Date(windowEnd).toISOString(),
  };
}

export function readingSessionTtlMs(): number {
  return (
    integerPolicy("READING_SESSION_TTL_MINUTES", DEFAULT_SESSION_TTL_MINUTES, 15, 7 * 24 * 60) *
    60_000
  );
}

export function normalizeReadingQuestion(question: string): string {
  return question
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function findRetainedReading(
  readings: readonly StoredReading[],
  question: string,
  decryptQuestion: (encrypted: string) => string,
  cooldownMs = rereadCooldownMs(),
  now = Date.now(),
): { reading: StoredReading; availableAt: string } | undefined {
  if (cooldownMs <= 0) return undefined;
  const normalized = normalizeReadingQuestion(question);
  if (!normalized) return undefined;

  for (const reading of [...readings].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const createdAt = Date.parse(reading.createdAt);
    if (!Number.isFinite(createdAt) || now - createdAt < 0 || now - createdAt >= cooldownMs)
      continue;
    try {
      if (normalizeReadingQuestion(decryptQuestion(reading.encryptedQuestion)) !== normalized)
        continue;
    } catch {
      continue;
    }
    return { reading, availableAt: new Date(createdAt + cooldownMs).toISOString() };
  }
  return undefined;
}

export function followUpLimitMessage(limit: number): string {
  if (limit <= 0) return "Follow-up questions are currently unavailable for this reading.";
  return `This reading includes ${limit} follow-up question${limit === 1 ? "" : "s"}. Keep the same cards in view and allow time for reflection.`;
}
