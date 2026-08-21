import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`reader-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("synthetic-private-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/consent$/, { timeout: 20_000 });
  await page.getByLabel(/I accept the current Terms/i).check();
  await page.getByLabel(/I have read the current Privacy Notice/i).check();
  await page.getByLabel(/I confirm that I am at least 18/i).check();
  await page.getByRole("button", { name: "Accept and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
}

async function createProfile(page: Page) {
  await signIn(page);
  await page.getByLabel("Full birth name").fill("Ada Lovelace");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  await page.getByRole("button", { name: "Continue to optional context" }).click();
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  await expect(page).toHaveURL(/\/readings$/, { timeout: 30_000 });
  await page.getByRole("button", { name: /^Continue with / }).click();
}

/** Mirrors mvp.spec.ts's centered, sequential ritual helper. */
async function finishRitual(page: Page) {
  const motionControl = page.getByRole("button", { name: /^Reduced motion/ });
  if ((await motionControl.getAttribute("aria-pressed")) !== "true") await motionControl.click();
  await expect(motionControl).toHaveAttribute("aria-pressed", "true");
  const sanctuary = page.getByTestId("mystic-sanctuary-scene");
  await expect(sanctuary).toHaveAttribute("data-reduced-motion", "true");
  const gather = page.getByRole("button", { name: "Gather now", exact: true });
  if (await gather.isVisible()) await gather.dispatchEvent("click").catch(() => {});
  await expect(sanctuary).toHaveAttribute("data-ritual-phase", "awaitingReveal", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("question-reflection")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "I’m ready", exact: true }).click();
  for (let index = 0; index < 10; index += 1) {
    await page
      .getByRole("button", { name: /^Reveal card \d+, face down$/ })
      .first()
      .click();
    const action = page.locator(".guided-next-action");
    await expect(action).toBeVisible();
    const finalCard = (await action.textContent())?.includes("Continue to your reading") === true;
    await action.click();
    if (finalCard) break;
  }
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 30_000 });
}

test("a crisis-flagged question pauses with real resources instead of the old inline error", async ({
  page,
}) => {
  await createProfile(page);
  await page.getByLabel("Your private question").fill("I want to die");
  const readingResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/readings",
  );
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  expect((await readingResponse).status()).toBe(422);
  await expect(page).toHaveURL(/\/readings$/);

  // Full-screen takeover, not the old buried `.sanctuary-error` paragraph: the
  // question composer is gone and a dedicated panel stands in its place.
  await expect(page.getByTestId("safety-interrupt-panel")).toBeVisible();
  await expect(page.getByLabel("Your private question")).toHaveCount(0);
  await expect(
    page.getByText(
      "If you may act on thoughts of suicide or self-harm, call emergency services now or use one of the crisis resources below. You do not need to handle this alone.",
    ),
  ).toBeVisible();
  // The heading text differs by detected locale (US/UK/international — see
  // crisis-resources.ts) but always starts this way; assert region-agnostically
  // rather than depending on Playwright's default locale.
  await expect(page.getByText(/Immediate support/)).toBeVisible();
  await expect(page.locator(".safety-interrupt-resources li").first()).toBeVisible();
});

test("a guarded question pauses before the shuffle, then can continue as reflection to completion", async ({
  page,
}) => {
  await createProfile(page);
  await page.getByLabel("Your private question").fill("Should I buy or sell this stock?");
  const readingResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/readings",
  );
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  const preflight = await readingResponse;
  expect(preflight.status()).toBe(409);
  expect(await preflight.json()).not.toHaveProperty("readingId");
  await expect(page).toHaveURL(/\/readings$/);

  // The acknowledgement happens before a reading, draw, or generation job is
  // created. Only the explicit second request may lock cards.
  await expect(page.getByText(/This question touches something the cards/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin the shuffle" })).toHaveCount(0);
  const acknowledgedResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/readings" &&
      response.status() === 201,
  );
  await page.getByRole("button", { name: "Continue as reflection", exact: true }).click();
  expect((await acknowledgedResponse).status()).toBe(201);
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });

  await finishRitual(page);

  await expect(
    page.getByText(
      "This reading offers reflection rather than a factual answer, given the kind of question it was.",
    ),
  ).toBeVisible();
});
