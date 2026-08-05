import "server-only";

const buckets = new Map<string, number[]>();

function firstForwardedValue(value: string | null): string | undefined {
  return value?.split(",", 1)[0]?.trim().toLowerCase();
}

/**
 * Netlify executes a deploy-preview Function on an immutable deploy hostname,
 * even when the browser used the stable deploy-preview alias. Prefer the
 * proxy-authenticated public host so auth cookies and callback redirects stay
 * on the hostname the browser actually visited.
 */
export function publicRequestOrigin(request: Request): string {
  const internalUrl = new URL(request.url);
  const host =
    firstForwardedValue(request.headers.get("x-forwarded-host")) ??
    firstForwardedValue(request.headers.get("host"));
  const protocol =
    firstForwardedValue(request.headers.get("x-forwarded-proto")) ??
    internalUrl.protocol.slice(0, -1);
  if (!host || (protocol !== "http" && protocol !== "https")) return internalUrl.origin;

  try {
    return new URL(`${protocol}://${host}`).origin;
  } catch {
    return internalUrl.origin;
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestHost = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!requestHost || new URL(origin).host !== requestHost) throw new Error("INVALID_ORIGIN");
}

export function assertRateLimit(key: string, limit: number, windowMs = 60_000): void {
  const now = Date.now();
  const recent = (buckets.get(key) ?? []).filter((timestamp) => timestamp > now - windowMs);
  if (recent.length >= limit) throw new Error("RATE_LIMITED");
  recent.push(now);
  buckets.set(key, recent);
}
