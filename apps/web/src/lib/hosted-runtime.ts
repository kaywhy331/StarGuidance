import "server-only";

export function isHostedNetlifyRuntime(): boolean {
  return Boolean(process.env.SITE_ID?.trim() || process.env.SITE_NAME?.trim());
}

export function isLocalRuntimeAdapterAuthorized(): boolean {
  const localEnvironment = process.env.APP_ENV === "development" || process.env.APP_ENV === "test";
  return (
    process.env.RUNTIME_ADAPTER === "local" &&
    process.env.ALLOW_LOCAL_RUNTIME_ADAPTER === "true" &&
    localEnvironment &&
    !isHostedNetlifyRuntime()
  );
}
