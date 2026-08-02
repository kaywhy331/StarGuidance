import { createDatabaseClient } from "@starguidance/database";
import { completeStage, record } from "@starguidance/database/staging-evidence";
import { expect, test, type BrowserContext } from "@playwright/test";

import {
  authenticate,
  createSyntheticIdentity,
  deleteSyntheticIdentity,
  type SyntheticIdentity,
} from "./synthetic-auth";

/**
 * Verifies the provisioning path that replaced the auth.users synchronisation
 * trigger removed by migration 0002, end to end on the deployed preview.
 *
 * The database is read as the subject itself — `authenticated` with
 * `request.jwt.claim.sub` bound — so "no row" cannot be confused with "a row
 * that forced row level security is hiding". No address, token, or subject is
 * ever recorded in the published evidence.
 */
test.describe.configure({ mode: "serial" });

function databaseUrl(): string {
  const value = process.env.DATABASE_INTEGRATION_URL?.trim();
  if (!value) throw new Error("DATABASE_INTEGRATION_URL is required for provisioning evidence");
  return value;
}

const sql = createDatabaseClient(databaseUrl());

let identity: SyntheticIdentity;
let context: BrowserContext;
let baseUrl: string;

/** Reads the subject's own application row through its own RLS context. */
async function ownRow(
  subjectId: string,
): Promise<{ count: number; email: string | undefined; createdAt: string | undefined }> {
  return sql.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claim.sub', ${subjectId}, true)`;
    const rows = await tx<{ email: string; created_at: Date }[]>`
      select email, created_at from users where id = ${subjectId}`;
    return {
      count: rows.length,
      email: rows[0]?.email,
      createdAt: rows[0] ? new Date(rows[0].created_at).toISOString() : undefined,
    };
  });
}

test.beforeAll(async ({ browser }, testInfo) => {
  baseUrl = String(testInfo.project.use.baseURL);
  context = await browser.newContext({ baseURL: baseUrl });
});

test.afterAll(async () => {
  await context?.close().catch(() => undefined);
  if (identity) await deleteSyntheticIdentity(identity);
  await sql.end({ timeout: 5 }).catch(() => undefined);
});

test("Supabase Auth creates an identity and no application row appears", async () => {
  identity = await createSyntheticIdentity("provisioning subject");
  const created = identity.creationStatus < 300;
  record({
    section: "Identity provisioning",
    check: "Supabase Auth identity creation succeeds",
    status: created ? "pass" : "fail",
    detail: `Admin API returned status ${identity.creationStatus}; the pre-0002 failure was 500`,
  });
  expect(identity.creationStatus, "Auth creation must not return a server error").toBeLessThan(300);

  const before = await ownRow(identity.id);
  const unprovisioned = before.count === 0;
  record({
    section: "Identity provisioning",
    check: "Auth creation provisions no application row",
    status: unprovisioned ? "pass" : "fail",
    detail: unprovisioned
      ? "no public.users row exists for the new subject, read in the subject's own RLS context"
      : "an application row already existed, so something still synchronises auth.users",
  });
  expect(unprovisioned, "no trigger may provision the row").toBe(true);
  completeStage("auth-identity-creation");
});

test("the first authenticated request provisions the row, idempotently", async () => {
  await authenticate(context, identity, baseUrl);
  const page = await context.newPage();

  const first = await page.evaluate(async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    return response.status;
  });
  const afterFirst = await ownRow(identity.id);

  const second = await page.evaluate(async () => {
    const response = await fetch("/api/profile", { cache: "no-store" });
    return response.status;
  });
  const afterSecond = await ownRow(identity.id);

  const provisioned = first === 200 && afterFirst.count === 1;
  record({
    section: "Identity provisioning",
    check: "First authenticated request provisions the application user",
    status: provisioned ? "pass" : "fail",
    detail: `authenticated request returned ${first}; exactly ${afterFirst.count} own row afterwards`,
  });

  const idempotent =
    second === 200 && afterSecond.count === 1 && afterSecond.createdAt === afterFirst.createdAt;
  record({
    section: "Identity provisioning",
    check: "Repeated provisioning changes nothing",
    status: idempotent ? "pass" : "fail",
    detail: idempotent
      ? "a second authenticated request left one row with an unchanged creation timestamp"
      : "a second authenticated request altered the provisioned row",
  });

  const normalised = afterSecond.email === identity.email.toLowerCase();
  record({
    section: "Identity provisioning",
    check: "Stored address is normalised to lower case",
    status: normalised ? "pass" : "fail",
    detail: normalised
      ? "the stored address matches the lower-cased Auth address"
      : "the stored address was not normalised",
  });

  await page.close();
  expect(provisioned, "the boundary provisions on first use").toBe(true);
  expect(idempotent, "provisioning is idempotent").toBe(true);
  expect(normalised, "address normalisation").toBe(true);
  completeStage("app-provisioning");
});
