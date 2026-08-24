import { createHmac } from "node:crypto";

import { completeStage, record } from "@starguidance/database/staging-evidence";
import { INTERPRETATION_WORKER_TOKEN_CONTEXT } from "@starguidance/contracts";
import { expect, test } from "@playwright/test";

import { calculationSchema } from "../../src/lib/profile-engine-contract";
import { assertServiceBaseUrl } from "../../src/lib/service-url";
import {
  signupActionPreservesRedirect,
  SYNTHETIC_EMAIL_DOMAIN,
  SYNTHETIC_EMAIL_PREFIX,
} from "./synthetic-auth";

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
  interpretation?: {
    providerKind?: string;
    approvedLiveProviderConfigured?: boolean;
  };
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
  const readinessSecret = process.env.READINESS_PROBE_SECRET;
  if (!readinessSecret) throw new Error("READINESS_PROBE_SECRET is required");
  const readinessToken = createHmac("sha256", readinessSecret)
    .update("starguidance-readiness-v1")
    .digest("base64url");
  const body = (await (
    await request.get("/api/health?readiness=1", {
      headers: { authorization: `Bearer ${readinessToken}` },
      timeout: 120_000,
    })
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
      check: "Interpretation provider is safely gated",
      ok:
        body.interpretation?.providerKind === "deterministic" ||
        (body.interpretation?.providerKind === "groq" &&
          body.interpretation.approvedLiveProviderConfigured === true),
      detail:
        `providerKind=${body.interpretation?.providerKind ?? "absent"}; ` +
        `approved=${body.interpretation?.approvedLiveProviderConfigured === true}`,
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

test("password authentication and account callbacks fail closed", async ({ request }) => {
  const probeAddress = `${SYNTHETIC_EMAIL_PREFIX}${process.env.GITHUB_RUN_ID ?? "local"}-probe@${SYNTHETIC_EMAIL_DOMAIN}`;
  const appOrigin = new URL(String(test.info().project.use.baseURL)).origin;
  const rejected = await request.post("/api/auth", {
    headers: { origin: appOrigin },
    data: {
      action: "sign-in",
      email: probeAddress,
      password: "synthetic-invalid-password",
    },
  });
  const rejectedBody = (await rejected.json()) as {
    authenticated?: boolean;
    error?: string;
  };
  const rejectedCleanly =
    rejected.status() === 401 &&
    rejectedBody.authenticated !== true &&
    typeof rejectedBody.error === "string" &&
    !JSON.stringify(rejectedBody).includes(probeAddress) &&
    !JSON.stringify(rejectedBody).includes("synthetic-invalid-password");
  record({
    section: "Auth callback",
    check: "Invalid password fails closed without credential disclosure",
    status: rejectedCleanly ? "pass" : "fail",
    detail: `status ${rejected.status()}; authenticated=${rejectedBody.authenticated === true}`,
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

  expect(rejectedCleanly, "invalid credentials fail closed without disclosure").toBe(true);
  expect(failsClosed, "invalid code fails closed").toBe(true);
  expect(missingClosed, "absent code fails closed").toBe(true);
});

test("Supabase preserves the deployed signup callback", async () => {
  const callback = new URL(
    "/auth/callback?next=%2Fonboarding",
    String(test.info().project.use.baseURL),
  ).toString();
  const callbackPreserved = await signupActionPreservesRedirect(callback);

  record({
    section: "Auth callback",
    check: "Supabase accepts the deployed signup callback",
    status: callbackPreserved ? "pass" : "fail",
    detail: callbackPreserved
      ? "the generated action retained the requested same-site callback"
      : "the provider substituted a different callback; review Auth URL Configuration",
  });
  expect(callbackPreserved, "Supabase Auth redirect allowlist accepts the deployed callback").toBe(
    true,
  );
});

test("the background-jobs drain route rejects bad tokens and reports both queue depths for a good one", async ({
  request,
}) => {
  const secret = process.env.INTERPRETATION_WORKER_SECRET?.trim();
  expect(secret, "INTERPRETATION_WORKER_SECRET must be provided").toBeTruthy();

  const missing = await request.post("/api/internal/interpretation-jobs");
  record({
    section: "Background workers",
    check: "Missing bearer token is rejected",
    status: missing.status() === 401 ? "pass" : "fail",
    detail: `status ${missing.status()}`,
  });

  // A token derived from the wrong secret, not the raw secret itself — proves
  // the route is actually comparing an HMAC rather than, say, always failing
  // open on a malformed header.
  const wrongToken = createHmac("sha256", "a-completely-different-secret-value!")
    .update(INTERPRETATION_WORKER_TOKEN_CONTEXT)
    .digest("base64url");
  const wrong = await request.post("/api/internal/interpretation-jobs", {
    headers: { authorization: `Bearer ${wrongToken}` },
  });
  record({
    section: "Background workers",
    check: "Incorrect bearer token is rejected",
    status: wrong.status() === 401 ? "pass" : "fail",
    detail: `status ${wrong.status()}`,
  });

  const token = createHmac("sha256", secret!)
    .update(INTERPRETATION_WORKER_TOKEN_CONTEXT)
    .digest("base64url");
  const authorized = await request.post("/api/internal/interpretation-jobs", {
    headers: { authorization: `Bearer ${token}` },
  });
  const authorizedBody = authorized.ok()
    ? ((await authorized.json()) as { queueDepth?: unknown; reportQueueDepth?: unknown })
    : undefined;
  const interpretationDepthReported = typeof authorizedBody?.queueDepth === "number";
  const reportDepthReported = typeof authorizedBody?.reportQueueDepth === "number";
  record({
    section: "Background workers",
    check: "Correct bearer token drains both queues and reports both depths",
    status:
      authorized.status() === 200 && interpretationDepthReported && reportDepthReported
        ? "pass"
        : "fail",
    detail: `status ${authorized.status()}; queueDepth ${interpretationDepthReported ? "reported" : "absent"}; reportQueueDepth ${reportDepthReported ? "reported" : "absent"}`,
  });

  expect(missing.status(), "missing token").toBe(401);
  expect(wrong.status(), "incorrect token").toBe(401);
  expect(authorized.status(), "correct token").toBe(200);
  expect(interpretationDepthReported, "the drain route reports interpretation queue depth").toBe(
    true,
  );
  expect(reportDepthReported, "the drain route reports report queue depth").toBe(true);
});
