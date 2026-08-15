/**
 * Validates that a configured service address is a base URL rather than one of
 * the service's own endpoints.
 *
 * A value like `https://engine.example/health` looks right in a settings pane
 * and passes every "is it an https URL" check, but every request built from it
 * targets `/health/health` or `/health/v1/profile/compute`. The result is a
 * 404 that reads as "the service is down" rather than "the variable is wrong",
 * which is a slow and misleading way to discover a typo.
 */
const ENDPOINT_SUFFIXES = ["/health", "/v1/profile/compute", "/healthz", "/ping"] as const;

export interface ServiceUrlProblem {
  readonly name: string;
  readonly reason: string;
}

export function findServiceUrlProblem(name: string, value: string): ServiceUrlProblem | undefined {
  const trimmed = value.trim();
  if (!trimmed) return { name, reason: "is empty" };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { name, reason: "is not an absolute URL" };
  }
  if (parsed.protocol !== "https:") return { name, reason: "is not https" };
  if (parsed.search || parsed.hash)
    return { name, reason: "carries a query string or fragment, so it is not a base URL" };

  const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  for (const suffix of ENDPOINT_SUFFIXES) {
    if (path === suffix || path.endsWith(suffix))
      return {
        name,
        reason: `ends in ${suffix}, which is an endpoint of the service rather than its base URL`,
      };
  }
  return undefined;
}

export function assertServiceBaseUrl(name: string, value: string): string {
  const problem = findServiceUrlProblem(name, value);
  if (problem) throw new Error(`${problem.name} ${problem.reason}`);
  return value.trim().replace(/\/+$/, "");
}
