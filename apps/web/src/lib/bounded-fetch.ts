/** Creates a fetch implementation that cannot wait indefinitely on a provider. */
export function createBoundedFetch(implementation: typeof fetch, timeoutMs: number): typeof fetch {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    throw new RangeError("A bounded fetch timeout must be a positive integer.");

  return (input, init) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return implementation(input, { ...init, signal });
  };
}
