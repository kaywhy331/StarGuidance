import { completeStage, record } from "@starguidance/database/staging-evidence";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  createSyntheticIdentity,
  deleteSyntheticIdentity,
  type SyntheticIdentity,
} from "./synthetic-auth";

/**
 * Exercises the deploy-preview guest consultation and its account handoff.
 *
 * The identity is created already confirmed through the staging Admin API, so
 * this is not a substitute for the owner-inbox delivery smoke test. It does
 * prove that the public form accepts the identity's stored password and that
 * becoming authenticated does not redraw the guest spread.
 */
test.describe.configure({ mode: "serial" });

const NAVIGATION_OPTIONS = { waitUntil: "commit" as const, timeout: 30_000 };
const NAVIGATION_ATTEMPTS = 3;

let identity: SyntheticIdentity;
let context: BrowserContext;
let page: Page;
let baseUrl: string;

interface FinalizedGuestReading {
  readonly reading: {
    readonly cards: readonly { cardId: string; orientation: "upright" | "reversed" }[];
    readonly draw: {
      readonly proof?: { readonly cutIndex?: number; readonly selectedIndexes?: readonly number[] };
    };
    readonly result?: unknown;
  };
}

function pagePath(targetPage: Page): string {
  try {
    return new URL(targetPage.url()).pathname;
  } catch {
    return "";
  }
}

async function navigate(
  targetPage: Page,
  target: string,
  ready: () => Promise<void>,
): Promise<void> {
  const expectedPath = new URL(target, baseUrl).pathname;
  let lastError: unknown;

  for (let attempt = 1; attempt <= NAVIGATION_ATTEMPTS; attempt += 1) {
    let committed = false;
    try {
      await targetPage.goto(target, NAVIGATION_OPTIONS);
      committed = true;
    } catch (error) {
      lastError = error;
      committed = pagePath(targetPage) === expectedPath;
    }

    if (committed) {
      try {
        await ready();
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (attempt < NAVIGATION_ATTEMPTS) await targetPage.waitForTimeout(attempt * 500);
  }

  throw lastError ?? new Error(`navigation to ${expectedPath} did not become ready`);
}

async function visibleAssignments(targetPage: Page): Promise<string[]> {
  const liveSpread = targetPage.getByTestId("tarot-spread-stage").locator(".physical-tarot-card");
  const cards = (await liveSpread.count())
    ? liveSpread
    : targetPage.locator(".guest-locked-spread-review li");
  return cards.evaluateAll((elements) =>
    elements.map(
      (card) =>
        `${card.getAttribute("data-card-id") ?? "missing"}:` +
        (card.getAttribute("data-orientation") ?? "missing"),
    ),
  );
}

test.beforeAll(async ({ browser }, testInfo) => {
  baseUrl = String(testInfo.project.use.baseURL);
  identity = await createSyntheticIdentity("guest continuation subject");
  context = await browser.newContext({ baseURL: baseUrl });
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close().catch(() => undefined);
  if (identity) await deleteSyntheticIdentity(identity);
});

test("a birthday-based free reading remains causal and continues through password sign-in", async () => {
  test.setTimeout(300_000);

  await navigate(page, "/", () =>
    expect(page.getByRole("link", { name: "Free Reading" })).toBeVisible({ timeout: 15_000 }),
  );
  await expect(page.getByRole("link", { name: "Free Reading" })).toHaveAttribute(
    "href",
    "/free-reading",
  );
  await navigate(page, "/free-reading", () =>
    expect(page.getByLabel("Your birthday")).toBeVisible({ timeout: 30_000 }),
  );

  await page.getByRole("button", { name: "Reduce motion" }).click();
  await page.getByLabel("Your birthday").fill("1990-01-15");
  await page.getByLabel(/I agree to the Terms/i).check();
  await page.getByLabel(/I have read the Privacy Notice/i).check();
  await page
    .getByLabel(/I confirm that I am at least 18/i)
    .evaluate((checkbox: HTMLInputElement) => checkbox.click());
  await expect(
    page.getByRole("heading", { name: "What question did you have for the stars today?" }),
  ).toBeVisible();

  const preparation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/guest-readings" &&
      response.request().postData()?.includes('"action":"prepare"') === true,
    { timeout: 60_000 },
  );
  await page
    .getByLabel("Your question for the stars")
    .fill("What can I understand about the next step in my work?");
  await page.getByRole("button", { name: "Send question" }).click();
  const preparedResponse = await preparation;
  const preparedBody = (await preparedResponse.json()) as {
    ceremony: { spread: { positions: readonly unknown[] } };
  };
  expect(preparedResponse.status(), "guest draw commitment is created").toBe(201);
  expect(JSON.stringify(preparedBody), "no card is assigned before user selection").not.toMatch(
    /"cardId"|"assignments"|"orientation"/,
  );

  await expect(page.getByTestId("guest-reading-experience")).toHaveAttribute(
    "data-ritual-phase",
    "shuffling",
  );
  await expect(page.locator(".casino-card-shell")).toHaveCount(78);
  await page.getByRole("button", { name: "Gather the cards" }).click();

  const finalization = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/guest-readings" &&
      response.request().postData()?.includes('"action":"finalize"') === true,
    { timeout: 60_000 },
  );
  const cardCount = preparedBody.ceremony.spread.positions.length;
  for (let index = 1; index <= cardCount; index += 1)
    await page
      .getByRole("button", { name: `Choose face-down card ${index}`, exact: true })
      .press("Enter");
  const finalizedResponse = await finalization;
  const finalized = (await finalizedResponse.json()) as FinalizedGuestReading;
  expect(finalizedResponse.status(), "guest draw finalizes after the selected backs").toBe(201);
  expect(finalized.reading.draw.proof?.selectedIndexes).toHaveLength(cardCount);
  expect(finalized.reading.draw.proof?.cutIndex, "new casino-wash sessions do not add a cut").toBe(
    0,
  );
  expect(finalized.reading.cards).toHaveLength(cardCount);
  expect(finalized.reading.result, "whole-reading prose remains private before reveal").toBe(
    undefined,
  );
  const originalAssignments = finalized.reading.cards.map(
    ({ cardId, orientation }) => `${cardId}:${orientation}`,
  );

  await expect(page.getByTestId("guest-question-reflection")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".physical-card-front")).toHaveCount(0);
  await expect(page.getByTestId("oracle-transcript")).toHaveCount(0);
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Reveal card 1, face down" }).click();
  await expect(page.getByTestId("guest-guided-reveal-panel")).toContainText("Situation");
  await expect(page.getByTestId("oracle-transcript")).toHaveCount(0);
  await expect.poll(async () => (await visibleAssignments(page))[0]).toBe(originalAssignments[0]);
  await page.getByRole("button", { name: /Return to the spread/ }).click();
  await page.getByRole("button", { name: "Reveal All" }).click();

  await expect(page.getByTestId("reading-active-passage")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("tarot-spread-stage")).toBeVisible();
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(cardCount);
  await expect(page.getByTestId("guest-signup-gate")).toHaveCount(0);
  await expect(page.getByTestId("guest-reading-experience")).toHaveAttribute(
    "data-reading-focus",
    "reading",
  );
  await page.getByTestId("oracle-transcript").press("End");
  await page.getByTestId("complete-reading-action").click();
  await expect(page.getByTestId("guest-signup-gate")).toBeVisible();
  await expect(page.getByTestId("guest-reading-experience")).toHaveAttribute(
    "data-reading-focus",
    "actions",
  );

  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.removeItem("sg:guest-trial-used:v1");
  });
  await navigate(page, "/free-reading", () =>
    expect(page.getByRole("region", { name: "Your locked tarot spread" })).toBeVisible({
      timeout: 30_000,
    }),
  );
  await expect(page.locator(".physical-card-front")).toHaveCount(0);
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Reveal card 1, face down" }).click();
  await expect
    .poll(async () => (await visibleAssignments(page))[0], {
      message: "receipt recovery preserves the revealed assignment",
    })
    .toBe(originalAssignments[0]);
  await page.getByRole("button", { name: /Return to the spread/ }).click();
  await page.getByRole("button", { name: "Reveal All" }).click();
  await expect(page.getByTestId("reading-active-passage")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("guest-signup-gate")).toHaveCount(0);
  await page.getByTestId("oracle-transcript").press("End");
  await page.getByTestId("complete-reading-action").click();
  await expect(page.getByTestId("guest-signup-gate")).toBeVisible();

  const signInLink = page.getByRole("link", { name: "Sign in" });
  await expect(signInLink).toHaveAttribute("href", "/sign-in?next=%2Ffree-reading%3Fcontinue%3D1");
  await navigate(page, "/sign-in?next=%2Ffree-reading%3Fcontinue%3D1", () =>
    expect(page.getByRole("button", { name: "Sign in" })).toBeVisible({ timeout: 30_000 }),
  );
  await page.getByLabel("Email").fill(identity.email);
  await page.getByLabel("Password").fill(identity.password);
  const passwordSignIn = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/auth",
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  const passwordSignInResponse = await passwordSignIn;
  expect(passwordSignInResponse.status(), "the stored password authenticates").toBe(200);

  // Navigate to the same destination carried by the form. Doing this explicitly
  // avoids treating Netlify's injected preview-toolbar transition abort as an
  // application failure; the local browser suite covers the router transition.
  await navigate(page, "/free-reading?continue=1", () =>
    expect(page.getByText("Same cards · account unlocked")).toBeVisible({ timeout: 60_000 }),
  );
  expect(await visibleAssignments(page), "account handoff preserves card and orientation").toEqual(
    originalAssignments,
  );

  await page
    .getByLabel("Ask these same cards one follow-up")
    .fill("What is one practical way to meet that same next step?");
  const followUp = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/guest-readings/continue" &&
      response.request().postData()?.includes('"action":"followUp"') === true,
    { timeout: 60_000 },
  );
  await page.getByRole("button", { name: "Ask the same cards" }).click();
  const followUpResponse = await followUp;
  expect(followUpResponse.status(), "same-subject follow-up is accepted").toBe(200);
  await expect(
    page.getByRole("heading", { name: "A clarification from the original spread" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/did not alter the cards/i)).toBeVisible();
  expect(await visibleAssignments(page), "follow-up does not redraw").toEqual(originalAssignments);

  record({
    section: "Guest reading",
    check: "Birthday-based reading is available before account creation",
    status: "pass",
    detail: "required birthday, direct question, and immutable positions completed anonymously",
  });
  record({
    section: "Guest reading",
    check: "Casino wash and selected backs causally finalize the draw",
    status: "pass",
    detail:
      "the commitment exposed no assignments; finalization persisted the user-picked hidden indexes",
  });
  record({
    section: "Guest reading",
    check: "Whole-reading synthesis stays hidden until every card is revealed",
    status: "pass",
    detail:
      "the finalization response omitted the result and the transcript remained absent during an individual reveal",
  });
  record({
    section: "Guest reading",
    check: "Password account handoff preserves the exact guest draw",
    status: "pass",
    detail:
      "receipt recovery, authenticated continuation, and same-subject follow-up retained every card and orientation",
  });
  completeStage("guest-trial");
});
