import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`reader-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("synthetic-private-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
}

async function createProfile(page: Page) {
  await signIn(page);
  await page.getByLabel("Full birth name").fill("Ada Lovelace");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  await expect(page).toHaveURL(/\/readings$/, { timeout: 30_000 });
}

/** Mirrors mvp.spec.ts's helper of the same name: the shuffle completes on its
 * own, then skip the deck cut and reveal every card. */
async function finishRitual(page: Page) {
  await page.getByRole("button", { name: "Skip cut", exact: true }).click();
  await page.getByRole("button", { name: "Reveal all", exact: true }).click();
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 30_000 });
}

test("a crisis-flagged question pauses with real resources instead of the old inline error", async ({
  page,
}) => {
  await createProfile(page);
  await page.getByLabel("Your private question").fill("I've been thinking about suicide lately.");
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
      "Pause the reading and connect the person with immediate local crisis or emergency support.",
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
  expect((await readingResponse).status()).toBe(201);
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });

  // GUARDED_CATEGORIES pauses here instead of shuffling straight in (distinct
  // from the selfHarmCrisis interrupt above: this is paced, not blocked).
  await expect(page.getByText(/This question touches something the cards/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin the shuffle" })).toHaveCount(0);
  await page.getByRole("button", { name: "Continue as reflection", exact: true }).click();

  await finishRitual(page);

  await expect(
    page.getByText(
      "This reading offers reflection rather than a factual answer, given the kind of question it was.",
    ),
  ).toBeVisible();
});
