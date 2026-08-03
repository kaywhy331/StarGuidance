import { completeStage, record } from "@starguidance/database/staging-evidence";
import { expect, test } from "@playwright/test";

import { calculationSchema } from "../../src/lib/profile-engine";
import { assertServiceBaseUrl } from "../../src/lib/service-url";
import { SYNTHETIC_EMAIL_DOMAIN, SYNTHETIC_EMAIL_PREFIX } from "./synthetic-auth";

/**
 * Probes the deployed dependencies of the staging preview. Only hostnames-free
 * status codes and booleans are recorded.
 */
const SYNTHETIC_COMPUTE_REQUEST = {
  full_birth_name: "Synthetic Verification",
  birth_date: "2000-01-01",
};

function profileEngineUrl(): string {
  const value = process.env.PROFILE_ENGINE_URL?.trim();
  if (!value) throw new Error("PROFILE_ENGINE_URL is required");
  // A value that already points at an endpoint would make every probe request
  // 404 and read as an unreachable service rather than a misconfigured name.
  return assertServiceBaseUrl("PROFILE_ENGINE_URL", value);
}

test.describe.configure({ mode: "serial" });

test("the hosted profile engine is healthy and refuses unauthorized computation", async () => {
  const base = profileEngineUrl();
  // A suspended free instance can need far longer than the application's own
  // 8s client timeout; allow a generous cold start so "asleep" is not reported
  // as "unreachable".
  const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(90_000) });
  record({
    section: "Profile engine",
    check: "GET /health returns 200",
    status: health.status === 200 ? "pass" : "fail",
    detail: `status ${health.status}`,
  });
  expect(health.status, "profile engine /health").toBe(200);

  const unauthorized = await fetch(`${base}/v1/profile/compute`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(SYNTHETIC_COMPUTE_REQUEST),
    signal: AbortSignal.timeout(60_000),
  });
  record({
    section: "Profile engine",
    check: "Unauthenticated compute returns 401",
    status: unauthorized.status === 401 ? "pass" : "fail",
    detail: `status ${unauthorized.status}`,
  });
  expect(unauthorized.status, "unauthenticated compute").toBe(401);

  const secret = process.env.PROFILE_ENGINE_SHARED_SECRET?.trim();
  expect(secret, "PROFILE_ENGINE_SHARED_SECRET must be provided").toBeTruthy();
  const authorized = await fetch(`${base}/v1/profile/compute`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
    body: JSON.stringify(SYNTHETIC_COMPUTE_REQUEST),
    signal: AbortSignal.timeout(60_000),
  });
  const authorizedBody = authorized.ok
    ? ((await authorized.json()) as { numerology?: { life_path?: number } })
    : undefined;
  const computed = typeof authorizedBody?.numerology?.life_path === "number";
  record({
    section: "Profile engine",
    check: "Authorized synthetic computation succeeds",
    status: authorized.status === 200 && computed ? "pass" : "fail",
    detail: `status ${authorized.status}; deterministic numerology ${computed ? "returned" : "absent"}`,
  });
  expect(authorized.status, "authorized compute").toBe(200);
  expect(computed, "authorized compute returned a deterministic result").toBe(true);

  // Checking one field would let the deployed engine drift away from the
  // contract the application enforces, and the application reports that drift
  // as "the engine could not complete the calculation" — indistinguishable
  // from an outage. Validate the whole payload here, and name the fields.
  const contract = calculationSchema.safeParse(authorizedBody);
  record({
    section: "Profile engine",
    check: "Computation matches the contract the application enforces",
    status: contract.success ? "pass" : "fail",
    detail: contract.success
      ? "the deployed engine's response satisfies every field the application requires"
      : `the response does not satisfy: ${[
          ...new Set(contract.error.issues.map((issue) => issue.path.join("."))),
        ]
          .slice(0, 12)
          .join(", ")}`,
  });
  expect(contract.success, "the deployed engine matches the application's contract").toBe(true);
  completeStage("profile-engine-probe");
});

interface HealthBody {
  deployedCommit?: string | null;
  appEnvironment?: string;
  runtimeAdapter?: string;
  localPersistenceEnabled?: boolean;
  localAdapterExplicitlyAllowed?: boolean;
  missingEnvironmentVariables?: string[];
  invalidEnvironmentVariables?: string[];
  database?: {
    connection?: boolean;
    schemaReady?: boolean;
    rlsReady?: boolean;
    actorTransactionReady?: boolean;
  };
}

test("the deployed preview runtime is staging, Supabase-backed, and schema ready", async ({
  request,
}) => {
  const body = (await (
    await request.get("/api/health", { timeout: 120_000 })
  ).json()) as HealthBody;
  // Global setup already waited for this build and refused to continue without
  // it; re-asserting here keeps the guarantee attached to the recorded stage.
  const expected = process.env.GITHUB_SHA?.trim();
  if (expected)
    expect(body.deployedCommit, "the preview must serve the commit under test").toBe(expected);

  const checks: { check: string; ok: boolean; detail: string }[] = [
    {
      check: "APP_ENV is staging",
      ok: body.appEnvironment === "staging",
      detail: `appEnvironment=${body.appEnvironment}`,
    },
    {
      check: "RUNTIME_ADAPTER is supabase",
      ok: body.runtimeAdapter === "supabase",
      detail: `runtimeAdapter=${body.runtimeAdapter}`,
    },
    {
      check: "Local persistence disabled",
      ok: body.localPersistenceEnabled === false && body.localAdapterExplicitlyAllowed === false,
      detail: `localPersistenceEnabled=${body.localPersistenceEnabled}`,
    },
    {
      check: "Required runtime configuration present",
      ok:
        (body.missingEnvironmentVariables?.length ?? 1) === 0 &&
        (body.invalidEnvironmentVariables?.length ?? 1) === 0,
      detail: `${body.missingEnvironmentVariables?.length ?? "?"} missing, ${
        body.invalidEnvironmentVariables?.length ?? "?"
      } invalid`,
    },
    {
      check: "Application schema present",
      ok: body.database?.connection === true && body.database?.schemaReady === true,
      detail: `connection=${body.database?.connection} schemaReady=${body.database?.schemaReady}`,
    },
    {
      check: "Authenticated database transactions available",
      ok: body.database?.rlsReady === true && body.database?.actorTransactionReady === true,
      detail: `rlsReady=${body.database?.rlsReady} actorTransactionReady=${body.database?.actorTransactionReady}`,
    },
  ];

  for (const { check, ok, detail } of checks)
    record({ section: "Netlify runtime", check, status: ok ? "pass" : "fail", detail });

  for (const { check, ok } of checks) expect(ok, check).toBe(true);
  completeStage("netlify-preview-probe");
});

test("the passwordless callback initiates and fails closed on an invalid code", async ({
  page,
  request,
}) => {
  const probeAddress = `${SYNTHETIC_EMAIL_PREFIX}${process.env.GITHUB_RUN_ID ?? "local"}-probe@${SYNTHETIC_EMAIL_DOMAIN}`;
  const initiated = await page.request.post("/api/auth", {
    headers: { origin: new URL(page.url() || test.info().project.use.baseURL || "/").origin },
    data: { email: probeAddress },
  });
  const initiatedBody = (await initiated.json()) as {
    pending?: boolean;
    retryable?: boolean;
    error?: string;
  };
  const initiationOk = initiated.status() === 200 && initiatedBody.pending === true;
  // Supabase validates deliverability before sending a magic link, so a
  // reserved `.test` address is refused by design and the project's hourly mail
  // quota can refuse the rest. Neither is an application defect, and neither
  // proves initiation works — the owner's real-inbox smoke test does that.
  // What is verifiable here is that the application relays the provider's
  // refusal as a well-formed client error rather than a server fault, and
  // without quoting the address back.
  const relayedCleanly =
    initiated.status() >= 400 &&
    initiated.status() < 500 &&
    typeof initiatedBody.error === "string" &&
    !JSON.stringify(initiatedBody).includes(probeAddress);
  record({
    section: "Auth callback",
    check: "Passwordless initiation accepted by Supabase",
    status: initiationOk ? "pass" : relayedCleanly ? "limited" : "fail",
    detail: initiationOk
      ? `status ${initiated.status()}; the provider queued a link`
      : relayedCleanly
        ? `not verifiable without a deliverable inbox: the provider refused a reserved .test ` +
          `address with status ${initiated.status()}, and the application relayed that as a ` +
          `client error without echoing the address. The owner real-inbox smoke test remains required.`
        : `status ${initiated.status()}; pending=${initiatedBody.pending === true}`,
  });

  const invalid = await request.get("/auth/callback?code=invalid-verification-code", {
    maxRedirects: 0,
  });
  const invalidLocation = invalid.headers().location ?? "";
  const failsClosed = invalid.status() >= 300 && invalidLocation.includes("/sign-in?error=");
  record({
    section: "Auth callback",
    check: "Invalid code fails closed to sign-in",
    status: failsClosed ? "pass" : "fail",
    detail: `redirected to ${failsClosed ? invalidLocation.replace(/^https?:\/\/[^/]+/, "") : "an unexpected destination"}`,
  });

  const missing = await request.get("/auth/callback", { maxRedirects: 0 });
  const missingLocation = missing.headers().location ?? "";
  const missingClosed = missing.status() >= 300 && missingLocation.includes("/sign-in?error=");
  record({
    section: "Auth callback",
    check: "Absent code fails closed to sign-in",
    status: missingClosed ? "pass" : "fail",
    detail: `redirected to ${missingClosed ? missingLocation.replace(/^https?:\/\/[^/]+/, "") : "an unexpected destination"}`,
  });

  record({
    section: "Auth callback",
    check: "Positive magic-link code exchange",
    status: "limited",
    detail:
      "not automated: the PKCE verifier is bound to the browser that initiated sign-in, so an " +
      "admin-generated link cannot produce a valid code. Owner inbox smoke test still required.",
  });

  expect(
    initiationOk || relayedCleanly,
    "the application must relay a provider refusal as a clean client error",
  ).toBe(true);
  expect(failsClosed, "invalid code fails closed").toBe(true);
  expect(missingClosed, "absent code fails closed").toBe(true);
});
