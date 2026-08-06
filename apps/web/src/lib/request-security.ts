import "server-only";

import { isIP } from "node:net";

const MAX_RATE_LIMIT_BUCKETS = 10_000;

interface RateLimitBucket {
  timestamps: number[];
  windowMs: number;
}

const buckets = new Map<string, RateLimitBucket>();

type RequestSecurityCode = "INVALID_ORIGIN" | "MISSING_ORIGIN" | "RATE_LIMITED";

export class RequestSecurityError extends Error {
  constructor(
    readonly code: RequestSecurityCode,
    readonly status: 403 | 429,
    readonly retryAfterSeconds?: number,
  ) {
    super(code);
    this.name = "RequestSecurityError";
  }
}

export interface RequestSecurityFailure {
  status: 403 | 429;
  error: string;
  headers: Record<string, string>;
}

export function requestSecurityFailure(error: unknown): RequestSecurityFailure | undefined {
  const code =
    error instanceof RequestSecurityError
      ? error.code
      : error instanceof Error &&
          ["INVALID_ORIGIN", "MISSING_ORIGIN", "RATE_LIMITED"].includes(error.message)
        ? (error.message as RequestSecurityCode)
        : undefined;
  if (!code) return undefined;
  if (code === "RATE_LIMITED") {
    const retryAfter = error instanceof RequestSecurityError ? error.retryAfterSeconds : 60;
    return {
      status: 429,
      error: "Too many requests. Try again shortly.",
      headers: { "retry-after": String(retryAfter ?? 60) },
    };
  }
  return { status: 403, error: "Request origin was rejected.", headers: {} };
}

function firstForwardedValue(value: string | null): string | undefined {
  return value?.split(",", 1)[0]?.trim().toLowerCase();
}

function netlifySiteName(hostname: string): string | undefined {
  const suffix = ".netlify.app";
  if (!hostname.endsWith(suffix)) return undefined;
  const label = hostname.slice(0, -suffix.length);
  return label.slice(label.lastIndexOf("--") + 2) || undefined;
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
    const candidate = new URL(`${protocol}://${host}`);
    if (candidate.host !== host) return internalUrl.origin;
    const expectedNetlifySite =
      process.env.SITE_NAME?.trim().toLowerCase() ?? netlifySiteName(internalUrl.hostname);
    if (expectedNetlifySite && netlifySiteName(candidate.hostname) !== expectedNetlifySite)
      return internalUrl.origin;
    return candidate.origin;
  } catch {
    return internalUrl.origin;
  }
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) throw new RequestSecurityError("MISSING_ORIGIN", 403);
  try {
    if (new URL(origin).origin !== publicRequestOrigin(request))
      throw new RequestSecurityError("INVALID_ORIGIN", 403);
  } catch (error) {
    if (error instanceof RequestSecurityError) throw error;
    throw new RequestSecurityError("INVALID_ORIGIN", 403);
  }
}

/**
 * Netlify overwrites this single-value header at its trusted proxy boundary.
 * Raw X-Forwarded-For is intentionally ignored because a client-controlled
 * leftmost value would let an attacker create unlimited buckets.
 */
export function clientRateLimitKey(request: Request): string {
  const netlifyRuntime = process.env.NETLIFY === "true" || process.env.APP_ENV === "test";
  const candidate = netlifyRuntime
    ? request.headers.get("x-nf-client-connection-ip")?.trim().toLowerCase()
    : undefined;
  if (!candidate) return "client:unresolved";
  const mappedIpv4 = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  const normalized = mappedIpv4 && isIP(mappedIpv4) === 4 ? mappedIpv4 : candidate;
  return isIP(normalized) ? `client:${normalized}` : "client:unresolved";
}

function evictBuckets(now: number): void {
  for (const [key, bucket] of buckets)
    if (bucket.timestamps.every((timestamp) => timestamp <= now - bucket.windowMs))
      buckets.delete(key);
  while (buckets.size >= MAX_RATE_LIMIT_BUCKETS) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (!oldest) break;
    buckets.delete(oldest);
  }
}

export function assertRateLimit(key: string, limit: number, windowMs = 60_000): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1)
    throw new TypeError("Rate-limit parameters must be positive integers.");
  const now = Date.now();
  const existing = buckets.get(key);
  const recent = (existing?.timestamps ?? []).filter((timestamp) => timestamp > now - windowMs);
  if (recent.length >= limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((recent[0]! + windowMs - now) / 1000));
    throw new RequestSecurityError("RATE_LIMITED", 429, retryAfterSeconds);
  }
  if (!existing && buckets.size >= MAX_RATE_LIMIT_BUCKETS) evictBuckets(now);
  recent.push(now);
  // Reinsert to maintain least-recently-used order for bounded eviction.
  buckets.delete(key);
  buckets.set(key, { timestamps: recent, windowMs });
}

export function resetRequestSecurityForTests(): void {
  buckets.clear();
}

export function rateLimitBucketCountForTests(): number {
  return buckets.size;
}
