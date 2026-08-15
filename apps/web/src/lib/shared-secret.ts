import "server-only";

const MINIMUM_SHARED_SECRET_LENGTH = 32;

// Mirrors apps/profile-engine/src/profile_engine/configuration.py's
// PROFILE_ENGINE_SHARED_SECRET check — the same "trivially weak" bar applied
// to every bearer secret this application fails closed on.
const WEAK_SECRET_MARKERS = [
  "change-me",
  "changeme",
  "example",
  "placeholder",
  "replace-me",
  "secret-value",
  "test-secret",
];

export function isWeakSharedSecret(secret: string | undefined | null): boolean {
  if (!secret) return true;
  const normalized = secret.toLowerCase();
  return (
    secret.length < MINIMUM_SHARED_SECRET_LENGTH ||
    secret !== secret.trim() ||
    new Set(secret).size < 8 ||
    WEAK_SECRET_MARKERS.some((marker) => normalized.includes(marker))
  );
}
