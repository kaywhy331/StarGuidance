import type { StoredReading } from "@starguidance/database";

const DEFAULT_FOLLOW_UP_LIMIT = 1;
const DEFAULT_REREAD_COOLDOWN_MINUTES = 30;

function integerPolicy(name: string, fallback: number, minimum: number, maximum: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : fallback;
}

export function followUpLimit(): number {
  return integerPolicy("READING_FOLLOW_UP_LIMIT", DEFAULT_FOLLOW_UP_LIMIT, 0, 10);
}

export function rereadCooldownMs(): number {
  return (
    integerPolicy("READING_REREAD_COOLDOWN_MINUTES", DEFAULT_REREAD_COOLDOWN_MINUTES, 0, 24 * 60) *
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
