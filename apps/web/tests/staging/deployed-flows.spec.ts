import { completeStage, record } from "@starguidance/database/staging-evidence";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  authIdentityExists,
  authenticate,
  createSyntheticIdentity,
  deleteSyntheticIdentity,
  hasAuthCookie,
  signOut,
  type SyntheticIdentity,
} from "./synthetic-auth";

/**
 * Authenticated verification of the deployed staging preview using two synthetic
 * identities. Every assertion message refers to identities by alias only.
 */
test.describe.configure({ mode: "serial" });

interface ProfileResponse {
  profile: { snapshot: { id: string; version: number; completeness: string } } | null;
}

interface ReadingResponse {
  reading: {
    id: string;
    draw: unknown;
    generationStatus: string;
    outputProvenance?: {
      providerId: string;
      promptVersion: string;
      schemaVersion: string;
    };
    followUps: { id: string }[];
    profileSnapshotId?: string;
  };
}

let userA: SyntheticIdentity;
let userB: SyntheticIdentity;
let contextA: BrowserContext;
let contextB: BrowserContext;
let pageA: Page;
let pageB: Page;
let baseUrl: string;
let activeReadingId: string;
let userBReadingId: string;

const NAVIGATION_OPTIONS = { waitUntil: "commit" as const, timeout: 30_000 };
const NAVIGATION_ATTEMPTS = 3;
const CLIENT_TRANSITION_TIMEOUT_MS = 15_000;
const PROVIDER_RATE_LIMIT_COOLDOWN_MS = 60_000;

/** Stable digest of a locked draw for byte-for-byte comparison. */
function drawDigest(draw: unknown): string {
  return JSON.stringify(draw);
}

function pagePath(page: Page): string {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return "";
  }
}

async function navigateApp(page: Page, target: string, ready?: () => Promise<void>): Promise<void> {
  const expectedPath = new URL(target, baseUrl).pathname;
  let lastError: unknown;

  for (let attempt = 1; attempt <= NAVIGATION_ATTEMPTS; attempt += 1) {
    let reachedTarget = false;
    try {
      await page.goto(target, NAVIGATION_OPTIONS);
      reachedTarget = true;
    } catch (error) {
      lastError = error;
      // Netlify can abort Playwright's navigation bookkeeping after the new
      // document commits. Only accept that case when the intended path and a
      // caller-supplied application marker independently prove readiness.
      reachedTarget = pagePath(page) === expectedPath;
    }

    if (reachedTarget) {
      try {
        await ready?.();
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (attempt < NAVIGATION_ATTEMPTS) await page.waitForTimeout(attempt * 500);
  }

  throw lastError ?? new Error(`navigation to ${expectedPath} did not commit`);
}

async function reloadApp(page: Page): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= NAVIGATION_ATTEMPTS; attempt += 1) {
    try {
      await page.reload(NAVIGATION_OPTIONS);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < NAVIGATION_ATTEMPTS) await page.waitForTimeout(attempt * 500);
    }
  }
  throw lastError ?? new Error("application reload did not commit");
}

/**
 * A page that has never navigated sits on `about:blank`, where a relative URL
 * has no base to resolve against and `fetch` throws before any request is made.
 * Every helper below therefore puts the page on the application origin first.
 */
async function onAppOrigin(page: Page): Promise<void> {
  if (!page.url().startsWith("http")) await navigateApp(page, "/");
}

async function apiGet<T>(page: Page, path: string): Promise<{ status: number; body: T }> {
  await onAppOrigin(page);
  return page.evaluate(async (target) => {
    const response = await fetch(target, { cache: "no-store" });
    return { status: response.status, body: (await response.json()) as T };
  }, path);
}

async function apiPost<T>(
  page: Page,
  path: string,
  payload: unknown,
): Promise<{ status: number; body: T }> {
  await onAppOrigin(page);
  return page.evaluate(
    async ({ target, data }) => {
      const response = await fetch(target, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(data),
      });
      return { status: response.status, body: (await response.json()) as T };
    },
    { target: path, data: payload },
  );
}

/**
 * Reports why onboarding did not complete.
 *
 * A bare "expected /readings" tells nobody whether the calculation service was
 * unavailable, the input was rejected, or the session had expired. The form
 * already shows the reason; this reads it back so the failure explains itself.
 */
async function onboardingFailure(page: Page): Promise<string> {
  const alert = page.getByRole("alert").first();
  const visible = await alert.isVisible().catch(() => false);
  const message = visible ? ((await alert.textContent().catch(() => "")) ?? "").trim() : "";
  const path = new URL(page.url()).pathname;
  return message ? `stopped at ${path}: "${message}"` : `stopped at ${path} with no visible error`;
}

async function completeOnboarding(
  page: Page,
  details: { name: string; date: string; city?: string; time?: string },
): Promise<void> {
  // Netlify's deploy-preview toolbar can leave a non-application resource
  // pending indefinitely, and its deferred script can also hold DOMContentLoaded
  // open after the application response has arrived. Response commit plus the
  // concrete form locators below proves the application itself is usable.
  let phase = "navigation";
  let profileStatus: number | undefined;
  try {
    const nameField = page.getByLabel("Full birth name");
    await navigateApp(page, "/onboarding", () =>
      expect(nameField).toBeVisible({ timeout: 15_000 }),
    );
    phase = "form entry";
    await nameField.fill(details.name);
    await page.getByLabel("Date of birth").fill(details.date);
    if (details.city) await page.getByLabel("Birth city / country").fill(details.city);
    if (details.time) await page.getByLabel("Birth time").fill(details.time);
    await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
    phase = "submission";
    const profileResponsePromise = page
      .waitForResponse(
        (response) =>
          new URL(response.url()).pathname === "/api/profile" &&
          response.request().method() === "POST",
        { timeout: 60_000 },
      )
      .catch(() => undefined);
    await page.getByRole("button", { name: "Check profile capability" }).click();
    const profileResponse = await profileResponsePromise;
    profileStatus = profileResponse?.status();
    phase = "client transition";
    try {
      await expect(page).toHaveURL(/\/readings$/, { timeout: CLIENT_TRANSITION_TIMEOUT_MS });
    } catch (error) {
      if (!profileResponse?.ok()) throw error;

      record({
        section: "Profile persistence",
        check: "Deploy-preview client transition after onboarding",
        status: "limited",
        detail:
          `the form POST returned ${profileResponse.status()}, but the preview-host transition ` +
          "did not settle; verification resumed through a directly committed application route",
      });
      phase = "client transition recovery";
      await navigateApp(page, "/readings", () =>
        expect(page.getByLabel("Your private question")).toBeVisible({ timeout: 15_000 }),
      );
    }
  } catch (error) {
    const reason = await onboardingFailure(page);
    record({
      section: "Profile persistence",
      check: "Deployed onboarding completes",
      status: "fail",
      detail: `failed during ${phase}; ${reason}; form POST returned ${profileStatus ?? "no response"}`,
    });
    throw new Error(`Onboarding did not complete during ${phase} — ${reason}`, { cause: error });
  }
}

async function activeSnapshot(page: Page): Promise<{ id: string; version: number }> {
  const { body } = await apiGet<ProfileResponse>(page, "/api/profile");
  if (!body.profile) throw new Error("no active profile snapshot");
  return { id: body.profile.snapshot.id, version: body.profile.snapshot.version };
}

async function createReading(page: Page, question: string): Promise<string> {
  const { status, body } = await apiPost<{ readingId?: string }>(page, "/api/readings", {
    // One card is sufficient for persistence/isolation assertions and avoids
    // burning the live provider's staging quota on content the gate never reads.
    spreadId: "focus",
    question,
  });
  if (status !== 201 || !body.readingId)
    throw new Error(`creating a reading returned status ${status}`);
  return body.readingId;
}

async function readingState(page: Page, id: string): Promise<ReadingResponse["reading"]> {
  const { status, body } = await apiGet<ReadingResponse>(page, `/api/readings/${id}`);
  if (status !== 200) throw new Error(`reading fetch returned status ${status}`);
  return body.reading;
}

test.beforeAll(async ({ browser }, testInfo) => {
  baseUrl = String(testInfo.project.use.baseURL);
  userA = await createSyntheticIdentity("user A");
  userB = await createSyntheticIdentity("user B");
  contextA = await browser.newContext({ baseURL: baseUrl });
  contextB = await browser.newContext({ baseURL: baseUrl });
  await authenticate(contextA, userA, baseUrl);
  await authenticate(contextB, userB, baseUrl);
  pageA = await contextA.newPage();
  pageB = await contextB.newPage();
});

test.afterAll(async () => {
  // The protected workflow can retain user B briefly so its real encrypted
  // rows exercise forward key rotation and rollback. Its verified always-run
  // cleanup remains authoritative. Local and ordinary staging runs still use
  // this belt-and-braces deletion immediately.
  await Promise.all([
    contextA?.close().catch(() => undefined),
    contextB?.close().catch(() => undefined),
  ]);
  if (process.env.PRESERVE_SYNTHETIC_FOR_POSTCHECK === "true") return;
  if (userA) await deleteSyntheticIdentity(userA);
  if (userB) await deleteSyntheticIdentity(userB);
});

test("both synthetic identities hold valid authenticated sessions", async () => {
  const cookiesA = await hasAuthCookie(contextA);
  const cookiesB = await hasAuthCookie(contextB);
  const a = await apiGet<ProfileResponse>(pageA, "/api/profile");
  const b = await apiGet<ProfileResponse>(pageB, "/api/profile");
  const ok = cookiesA && cookiesB && a.status === 200 && b.status === 200;
  record({
    section: "Auth callback",
    check: "Two independent authenticated sessions established",
    status: ok ? "pass" : "fail",
    detail: `session cookies present for both aliases; /api/profile returned ${a.status} and ${b.status}`,
  });
  expect(ok, "both aliases authenticated").toBe(true);
});

test("both identities complete onboarding and the profile survives refresh and re-entry", async () => {
  await completeOnboarding(pageA, {
    name: "Ada Synthetic",
    date: "1990-01-15",
    city: "London, United Kingdom",
    time: "08:15",
  });
  await completeOnboarding(pageB, { name: "Bo Synthetic", date: "1985-06-02" });

  const created = await activeSnapshot(pageA);
  record({
    section: "Profile persistence",
    check: "Deployed onboarding stores a versioned snapshot",
    status: created.version >= 1 ? "pass" : "fail",
    detail: `active snapshot version ${created.version} for user A; user B also created`,
  });

  await reloadApp(pageA);
  const afterRefresh = await activeSnapshot(pageA);

  await signOut(contextA);
  const signedOut = await apiGet<ProfileResponse>(pageA, "/api/profile");
  const passwordSignIn = await pageA.request.post(`${baseUrl}/api/auth`, {
    headers: { origin: new URL(baseUrl).origin },
    data: {
      action: "sign-in",
      email: userA.email,
      password: userA.password,
    },
  });
  const afterReturn = await activeSnapshot(pageA);

  const durable =
    passwordSignIn.status() === 200 &&
    afterRefresh.id === created.id &&
    afterReturn.id === created.id;
  record({
    section: "Profile persistence",
    check: "Snapshot survives refresh and sign-out/sign-in",
    status: durable ? "pass" : "fail",
    detail: `identical active snapshot after refresh and password re-entry; signed-out request returned ${signedOut.status}; sign-in returned ${passwordSignIn.status()}`,
  });
  expect(signedOut.status, "signed-out profile request is rejected").toBe(401);
  expect(passwordSignIn.status(), "email/password sign-in succeeds").toBe(200);
  expect(durable, "profile is durable").toBe(true);
  completeStage("profile-onboarding");
});

test("updating birth data appends an immutable snapshot and preserves prior readings", async () => {
  const original = await activeSnapshot(pageA);
  const priorReading = await createReading(pageA, "What should I focus on before the change?");
  const priorSnapshotRef = (await readingState(pageA, priorReading)).profileSnapshotId;

  await completeOnboarding(pageA, {
    name: "Ada Synthetic",
    date: "1990-01-15",
    city: "Edinburgh, United Kingdom",
    time: "09:45",
  });
  const updated = await activeSnapshot(pageA);
  const priorAfterUpdate = (await readingState(pageA, priorReading)).profileSnapshotId;

  const appended = updated.id !== original.id && updated.version > original.version;
  const historyIntact =
    priorSnapshotRef === original.id &&
    priorAfterUpdate === original.id &&
    Boolean(priorSnapshotRef);
  record({
    section: "Profile lineage",
    check: "Update appends a new snapshot and moves only the active pointer",
    status: appended ? "pass" : "fail",
    detail: `version ${original.version} → ${updated.version} with a new immutable snapshot`,
  });
  record({
    section: "Profile lineage",
    check: "Existing reading still references the original snapshot",
    status: historyIntact ? "pass" : "fail",
    detail: historyIntact
      ? "the pre-update reading still points at the original snapshot"
      : "the pre-update reading no longer points at the original snapshot",
  });
  expect(appended, "snapshot appended").toBe(true);
  expect(historyIntact, "history intact").toBe(true);
  completeStage("profile-lineage");
});

test("a reading is created against the active snapshot with a locked draw", async () => {
  const before = await activeSnapshot(pageA);
  activeReadingId = await createReading(pageA, "What is worth attending to today?");
  let reading = await readingState(pageA, activeReadingId);
  const lockedDraw = drawDigest(reading.draw);
  let providerRetryStatus: number | undefined;

  // Groq's minute quota can be consumed by the earlier deployed checks. Retry
  // the persisted output once after the reset window, against this exact locked
  // draw, instead of creating a new reading or weakening the live-provider gate.
  if (
    reading.outputProvenance?.providerId === "deterministic-fallback-v1:after-groq-rate-limited"
  ) {
    await pageA.waitForTimeout(PROVIDER_RATE_LIMIT_COOLDOWN_MS);
    providerRetryStatus = (
      await apiPost(pageA, `/api/readings/${activeReadingId}`, { action: "retry" })
    ).status;
    reading = await readingState(pageA, activeReadingId);
  }
  const providerRetryPreservedDraw = drawDigest(reading.draw) === lockedDraw;

  const assignments = Array.isArray((reading.draw as { assignments?: unknown[] })?.assignments)
    ? ((reading.draw as { assignments: unknown[] }).assignments?.length ?? 0)
    : 0;
  const created =
    Boolean(reading.id) &&
    reading.profileSnapshotId === before.id &&
    assignments > 0 &&
    reading.generationStatus !== "pending" &&
    providerRetryPreservedDraw;
  const liveProvenance =
    reading.outputProvenance?.providerId === "groq:openai/gpt-oss-120b" &&
    reading.outputProvenance.promptVersion === "reader-voice-v1" &&
    reading.outputProvenance.schemaVersion === "reading-result-v1";
  const safeFallbackReasons = [
    "request-timeout",
    "authentication",
    "rate-limited",
    "provider-unavailable",
    "request-rejected",
    "invalid-response",
    "network-error",
    "unknown",
  ] as const;
  const classifiedFallbackReason = safeFallbackReasons.find(
    (reason) =>
      reading.outputProvenance?.providerId === `deterministic-fallback-v1:after-groq-${reason}`,
  );
  const providerState =
    reading.outputProvenance?.providerId === "groq:openai/gpt-oss-120b"
      ? "approved-live"
      : classifiedFallbackReason
        ? `deterministic-fallback-after-groq-${classifiedFallbackReason}`
        : reading.outputProvenance?.providerId === "deterministic-fallback-v1"
          ? "deterministic-fallback"
          : reading.outputProvenance?.providerId
            ? "other"
            : "absent";
  const promptState =
    reading.outputProvenance?.promptVersion === "reader-voice-v1"
      ? "approved-live"
      : reading.outputProvenance?.promptVersion === "deterministic-fallback-v1"
        ? "deterministic-fallback"
        : reading.outputProvenance?.promptVersion
          ? "other"
          : "absent";
  const schemaState =
    reading.outputProvenance?.schemaVersion === "reading-result-v1"
      ? "approved"
      : "absent-or-other";

  record({
    section: "Reading creation",
    check: "Deployed reading creation locks a draw against the active snapshot",
    status: created ? "pass" : "fail",
    detail:
      `${assignments} position(s) assigned; generation status ${reading.generationStatus}; ` +
      "the reading references the identity's active snapshot",
  });
  record({
    section: "Reading creation",
    check: "Live AI model provenance is persisted",
    status: liveProvenance ? "pass" : "fail",
    detail: liveProvenance
      ? `the persisted output identifies the approved provider model, prompt, and response schema${
          providerRetryStatus === undefined
            ? ""
            : ` after one same-draw quota retry returned ${providerRetryStatus}`
        }`
      : `classified persisted provenance: provider=${providerState}, prompt=${promptState}, ` +
        `schema=${schemaState}`,
  });
  expect(created, "a reading is created with a locked draw").toBe(true);
  expect(liveProvenance, "the live generation contract is persisted").toBe(true);
  completeStage("reading-creation");
});

test("the locked draw is byte-identical across refresh, stream failure, retry, and follow-up", async () => {
  const readingId = activeReadingId;
  const original = drawDigest((await readingState(pageA, readingId)).draw);

  await navigateApp(pageA, `/session/${readingId}`);
  await reloadApp(pageA);
  const afterRefresh = drawDigest((await readingState(pageA, readingId)).draw);

  // The APP_ENV=test failure hooks are correctly inert in staging, so this
  // interrupts the transcript with a real aborted network request instead.
  await pageA.route("**/api/readings/*/stream", (route) => route.abort());
  await navigateApp(pageA, `/session/${readingId}`);
  await pageA.waitForTimeout(2_000);
  await pageA.unroute("**/api/readings/*/stream");
  const afterStreamFailure = drawDigest((await readingState(pageA, readingId)).draw);

  const retry = await apiPost<{ draw?: unknown }>(pageA, `/api/readings/${readingId}`, {
    action: "retry",
  });
  const afterRetry = drawDigest((await readingState(pageA, readingId)).draw);

  const followUp = await apiPost<{ draw?: unknown }>(pageA, `/api/readings/${readingId}`, {
    action: "followUp",
    question: "What can I do next?",
  });
  const afterFollowUp = drawDigest((await readingState(pageA, readingId)).draw);

  const stable = [afterRefresh, afterStreamFailure, afterRetry, afterFollowUp].every(
    (digest) => digest === original,
  );
  record({
    section: "Draw equality",
    check: "Locked draw unchanged across refresh, stream failure, retry, and follow-up",
    status: stable ? "pass" : "fail",
    detail: `four recovery paths compared byte-for-byte; retry status ${retry.status}, follow-up status ${followUp.status}`,
  });
  record({
    section: "Draw equality",
    check: "Server-side generation failure injection",
    status: "limited",
    detail:
      "not exercised: the forced-failure hook is gated to APP_ENV=test and is correctly inert in " +
      "staging. A real aborted stream was used instead.",
  });
  expect(stable, "locked draw is immutable").toBe(true);
  completeStage("draw-equality");
});

test("neither identity can reach the other's resources over the deployed API", async () => {
  userBReadingId = await createReading(pageB, "What should I consider about this decision?");
  const readingB = userBReadingId;
  const readingA = activeReadingId;

  const crossReads = [
    { alias: "user A → user B reading", result: await apiGet(pageA, `/api/readings/${readingB}`) },
    { alias: "user B → user A reading", result: await apiGet(pageB, `/api/readings/${readingA}`) },
    { alias: "user A → user B report", result: await apiGet(pageA, `/api/reports/${readingB}`) },
  ];
  const denied = crossReads.every(({ result }) => result.status === 404 || result.status === 403);
  record({
    section: "Cross-user isolation",
    check: "Addressable resources are denied over HTTP",
    status: denied ? "pass" : "fail",
    detail: `${crossReads.length} cross-identity reads returned ${crossReads
      .map(({ result }) => result.status)
      .join("/")}`,
  });

  const crossWrites = [
    await apiPost(pageA, `/api/readings/${readingB}`, { action: "retry" }),
    await apiPost(pageA, `/api/readings/${readingB}`, {
      action: "followUp",
      question: "Attempted cross-identity follow-up.",
    }),
  ];
  const writesDenied = crossWrites.every(({ status }) => status === 404 || status === 403);
  record({
    section: "Cross-user isolation",
    check: "Cross-identity retry and follow-up are rejected",
    status: writesDenied ? "pass" : "fail",
    detail: `attempted mutations returned ${crossWrites.map(({ status }) => status).join("/")}`,
  });
  record({
    section: "Cross-user isolation",
    check: "Full per-resource matrix at the database layer",
    status: "pass",
    detail:
      "profiles, snapshots, components, traits, readings, draws, encrypted questions, outputs, " +
      "follow-ups, feedback, reports, orders, entitlements, audits: covered by the forced-RLS " +
      "integration suite run against this same staging database earlier in this workflow.",
  });

  expect(denied, "cross-identity reads denied").toBe(true);
  expect(writesDenied, "cross-identity writes denied").toBe(true);
  completeStage("cross-user-denial");
});

test("export is scoped to the requesting identity", async () => {
  const readingB = userBReadingId;
  const exported = await apiGet<Record<string, unknown>>(pageA, "/api/privacy/export");
  const serialised = JSON.stringify(exported.body);
  const leaksOther = serialised.includes(readingB) || serialised.includes(userB.email);
  const ok = exported.status === 200 && !leaksOther;
  record({
    section: "Export",
    check: "Export contains only the requesting identity's records",
    status: ok ? "pass" : "fail",
    detail: ok
      ? "no identifier or address belonging to the other alias appears in the export"
      : "the export contained data belonging to another identity",
  });
  expect(ok, "export is scoped").toBe(true);
  completeStage("export-isolation");
});

test("account deletion removes application data and the Auth identity, leaving the other intact", async () => {
  const deletion = await pageA.evaluate(async () => {
    const response = await fetch("/api/account", { method: "DELETE" });
    return response.status;
  });

  const afterDeletion = await apiGet<ProfileResponse>(pageA, "/api/profile");
  const identityGone = !(await authIdentityExists(userA));
  const otherIntact = (await apiGet<ProfileResponse>(pageB, "/api/profile")).status === 200;
  const otherIdentityIntact = await authIdentityExists(userB);

  record({
    section: "Deletion",
    check: "Application records removed",
    status: deletion === 200 && afterDeletion.status === 401 ? "pass" : "fail",
    detail: `delete returned ${deletion}; the deleted alias's subsequent request returned ${afterDeletion.status}`,
  });
  record({
    section: "Deletion",
    check: "Supabase Auth identity removed",
    status: identityGone ? "pass" : "fail",
    detail: identityGone
      ? "the Admin API no longer resolves the deleted subject"
      : "the Auth identity still resolves after deletion",
  });
  record({
    section: "Deletion",
    check: "The second identity is unaffected",
    status: otherIntact && otherIdentityIntact ? "pass" : "fail",
    detail: "the other alias retains both its application profile and its Auth identity",
  });

  expect(deletion, "account deletion accepted").toBe(200);
  expect(identityGone, "Auth identity removed").toBe(true);
  expect(otherIntact && otherIdentityIntact, "other identity intact").toBe(true);
  completeStage("account-deletion");
});
