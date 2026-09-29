export const GUEST_READING_CONTINUATION_PATH = "/free-reading?continue=1";
/**
 * The same continuation carrying a sealed guest handoff in the fragment, so a
 * confirmation link opened in another browser can still recover the draw.
 * The token is server-encrypted and never contains the birthday.
 */
const GUEST_HANDOFF_RETURN_PATTERN =
  /^\/free-reading\?continue=1#handoff=h1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{1,6000}\.[A-Za-z0-9_-]{22}$/;
const GUEST_HANDOFF_RETURN_MAX_LENGTH = 6_200;

/** Exact signed-in pages a protected redirect may send someone back to. */
const RETURNABLE_PAGES = new Set([
  "/readings",
  "/reports",
  "/onboarding",
  "/history",
  "/profile",
  "/people",
  "/settings/account",
  "/settings/privacy",
]);
/** A single reading or session, addressed only by its UUID. */
const RETURNABLE_READING_PATTERN =
  /^\/(?:session|reading|report)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Account entry points accept only product-owned, explicitly supported return
 * destinations. Keeping this allow-list narrow prevents an auth flow from
 * becoming an open redirect as more query parameters are introduced.
 */
export function safeAccountReturnPath(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (typeof candidate !== "string") return undefined;
  if (candidate === GUEST_READING_CONTINUATION_PATH) return candidate;
  if (
    candidate.length <= GUEST_HANDOFF_RETURN_MAX_LENGTH &&
    GUEST_HANDOFF_RETURN_PATTERN.test(candidate)
  )
    return candidate;
  if (RETURNABLE_PAGES.has(candidate)) return candidate;
  return RETURNABLE_READING_PATTERN.test(candidate) ? candidate : undefined;
}

/** The sign-in URL that returns someone to `path` once they are signed in. */
export function signInPathFor(path: string): string {
  const next = safeAccountReturnPath(path);
  return next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in";
}
