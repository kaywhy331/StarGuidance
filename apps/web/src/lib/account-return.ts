export const GUEST_READING_CONTINUATION_PATH = "/free-reading?continue=1";

/**
 * Account entry points accept only product-owned, explicitly supported return
 * destinations. Keeping this allow-list narrow prevents an auth flow from
 * becoming an open redirect as more query parameters are introduced.
 */
export function safeAccountReturnPath(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return candidate === GUEST_READING_CONTINUATION_PATH ? candidate : undefined;
}
