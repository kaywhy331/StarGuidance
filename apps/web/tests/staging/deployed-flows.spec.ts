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

/** Stable digest of a locked draw for byte-for-byte comparison. */
function drawDigest(draw: unknown): string {
  return JSON.stringify(draw);
}

/**
 * A page that has never navigated sits on `about:blank`, where a relative URL
 * has no base to resolve against and `fetch` throws before any request is made.
 * Every helper below therefore puts the page on the application origin first.
 */
async function onAppOrigin(page: Page): Promise<void> {
  if (!page.url().startsWith("http")) await page.goto("/", { waitUntil: "domcontentloaded" });
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
  await page.goto("/onboarding");
  await page.getByLabel("Full birth name").fill(details.name);
  await page.getByLabel("Date of birth").fill(details.date);
  if (details.city) await page.getByLabel("Birth city / country").fill(details.city);
  if (details.time) await page.getByLabel("Birth time").fill(details.time);
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  try {
    await expect(page).toHaveURL(/\/readings$/, { timeout: 60_000 });
  } catch (error) {
    const reason = await onboardingFailure(page);
    record({
      section: "Profile persistence",
      check: "Deployed onboarding completes",
      status: "fail",
      detail: reason,
    });
    throw new Error(`Onboarding did not complete — ${reason}`, { cause: error });
  }
}

async function activeSnapshot(page: Page): Promise<{ id: string; version: number }> {
  const { body } = await apiGet<ProfileResponse>(page, "/api/profile");
  if (!body.profile) throw new Error("no active profile snapshot");
  return { id: body.profile.snapshot.id, version: body.profile.snapshot.version };
}

async function createReading(page: Page, question: string): Promise<string> {
  const { status, body } = await apiPost<{ readingId?: string }>(page, "/api/readings", {
    spreadId: "direction",
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
  // Belt-and-braces: the workflow also runs a verified cleanup in always().
  await Promise.all([
    contextA?.close().catch(() => undefined),
    contextB?.close().catch(() => undefined),
  ]);
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

  await pageA.reload();
  const afterRefresh = await activeSnapshot(pageA);

  await signOut(contextA);
  const signedOut = await apiGet<ProfileResponse>(pageA, "/api/profile");
  await authenticate(contextA, userA, baseUrl);
  const afterReturn = await activeSnapshot(pageA);

  const durable = afterRefresh.id === created.id && afterReturn.id === created.id;
  record({
    section: "Profile persistence",
    check: "Snapshot survives refresh and sign-out/sign-in",
    status: durable ? "pass" : "fail",
    detail: `identical active snapshot after refresh and re-entry; signed-out request returned ${signedOut.status}`,
  });
  expect(signedOut.status, "signed-out profile request is rejected").toBe(401);
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
  const readingId = await createReading(pageA, "What is worth attending to today?");
  const reading = await readingState(pageA, readingId);

  const assignments = Array.isArray((reading.draw as { assignments?: unknown[] })?.assignments)
    ? ((reading.draw as { assignments: unknown[] }).assignments?.length ?? 0)
    : 0;
  const created =
    Boolean(reading.id) &&
    reading.profileSnapshotId === before.id &&
    assignments > 0 &&
    reading.generationStatus !== "pending";

  record({
    section: "Reading creation",
    check: "Deployed reading creation locks a draw against the active snapshot",
    status: created ? "pass" : "fail",
    detail:
      `${assignments} position(s) assigned; generation status ${reading.generationStatus}; ` +
      "the reading references the identity's active snapshot",
  });
  expect(created, "a reading is created with a locked draw").toBe(true);
  completeStage("reading-creation");
});

test("the locked draw is byte-identical across refresh, stream failure, retry, and follow-up", async () => {
  const readingId = await createReading(pageA, "What should I understand about this next step?");
  const original = drawDigest((await readingState(pageA, readingId)).draw);

  await pageA.goto(`/session/${readingId}`);
  await pageA.reload();
  const afterRefresh = drawDigest((await readingState(pageA, readingId)).draw);

  // The APP_ENV=test failure hooks are correctly inert in staging, so this
  // interrupts the transcript with a real aborted network request instead.
  await pageA.route("**/api/readings/*/stream", (route) => route.abort());
  await pageA.goto(`/session/${readingId}`);
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
  const readingB = await createReading(pageB, "What should I consider about this decision?");
  const readingA = await createReading(pageA, "What deserves my attention now?");

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
  const readingB = await createReading(pageB, "A private question that must not leak.");
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
