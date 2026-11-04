/**
 * Browser-side request helper. Every user-facing fetch in the app goes
 * through here so a dropped connection, an HTML error page from the edge, or
 * a slow server can never leave a spinner running with no message.
 */

export const CONNECTION_LOST_MESSAGE =
  "The connection faltered before the stars could answer. Please try again.";
export const SERVER_UNAVAILABLE_MESSAGE =
  "Something went quiet on our side. Please try again in a moment.";

export type ClientResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; error: string; data: Record<string, unknown> };

export interface ClientRequestInit extends RequestInit {
  /** Abort after this many milliseconds (default 20 s). 0 disables it. */
  timeoutMs?: number;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function friendlyStatusMessage(status: number): string {
  if (status === 401) return "Please sign in again to continue.";
  if (status === 429) return "That was a lot at once. Please wait a moment and try again.";
  if (status >= 500) return SERVER_UNAVAILABLE_MESSAGE;
  return "That request could not be completed. Please try again.";
}

/**
 * Fetches JSON and never throws. Non-2xx responses resolve to `ok: false`
 * with the server's `error` string when it sent one, otherwise a calm
 * fallback. Network failures and timeouts resolve with `status: 0`.
 */
export async function requestJson<T = Record<string, unknown>>(
  input: string,
  init: ClientRequestInit = {},
): Promise<ClientResult<T>> {
  const { timeoutMs = 20_000, ...rest } = init;
  const signals: AbortSignal[] = [];
  if (rest.signal) signals.push(rest.signal);
  if (timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs));
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];

  let response: Response;
  try {
    response = await fetch(input, { ...rest, ...(signal ? { signal } : {}) });
  } catch {
    return { ok: false, status: 0, error: CONNECTION_LOST_MESSAGE, data: {} };
  }
  const body = await readBody(response);
  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  if (response.ok) return { ok: true, status: response.status, data: body as T };
  const serverMessage = typeof record.error === "string" && record.error ? record.error : undefined;
  return {
    ok: false,
    status: response.status,
    error: serverMessage ?? friendlyStatusMessage(response.status),
    data: record,
  };
}

/** Convenience wrapper for JSON POST/PATCH/DELETE bodies. */
export function sendJson<T = Record<string, unknown>>(
  input: string,
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  body?: unknown,
  init: ClientRequestInit = {},
): Promise<ClientResult<T>> {
  return requestJson<T>(input, {
    ...init,
    method,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
