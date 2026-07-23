import "server-only";

const buckets = new Map<string, number[]>();

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
