import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test, type Page, type TestInfo } from "@playwright/test";

async function captureGuestReview(page: Page, testInfo: TestInfo, name: string) {
  if (!process.env.CAPTURE_GUEST_SCREENSHOTS) return;
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    path: path.resolve(
      process.cwd(),
      "../../docs/screenshots",
      `${name}-${testInfo.project.name}.png`,
    ),
  });
}

async function revealGuestCards(page: Page) {
  await expect(page.getByTestId("guest-question-reflection")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "I’m ready" }).dispatchEvent("click");

  for (let index = 0; index < 3; index += 1) {
    const card = page.getByRole("button", { name: /^Reveal card \d+, face down$/ }).first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await card.dispatchEvent("click");
  }

  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 20_000 });
  const transcript = page.getByTestId("oracle-transcript");
  const nextPassage = page.getByRole("button", { name: "Next reading passage" });
  for (let index = 0; index < 3; index += 1) await nextPassage.click();
  await expect(transcript).toHaveAttribute("data-active-card-index", "2");
  await nextPassage.click();
  await expect(transcript).not.toHaveAttribute("data-active-card-index", /.+/);
  await expect(page.getByRole("heading", { name: "Turning point", exact: true })).toBeVisible();
  await nextPassage.click();
  await expect(page.getByRole("heading", { name: "Likely trajectory", exact: true })).toBeVisible();

  const completeStory = page.getByRole("button", { name: "Read as one story" });
  await expect(completeStory).toBeEnabled();
  await completeStory.dispatchEvent("click");
  await page.getByRole("button", { name: /Continue with these cards/ }).dispatchEvent("click");
  await expect(page.getByTestId("guest-signup-gate")).toBeVisible();
}

test("a visitor reads before signup and continues with the exact cards", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);

  await page.goto("/");
  const freeReading = page.getByRole("link", { name: "Free Reading" });
  await expect(freeReading).toBeVisible();
  await expect(freeReading).toHaveAttribute("href", "/free-reading");
  await expect(page.getByRole("link", { name: "Sign up", exact: true })).toBeVisible();
  await Promise.all([page.waitForURL(/\/free-reading$/, { timeout: 30_000 }), freeReading.click()]);

  await expect(
    page.getByRole("heading", { name: "Meet the cards before you decide to stay." }),
  ).toBeVisible({ timeout: 30_000 });
  const spreadOptions = page.getByRole("radiogroup", { name: "Free reading type" });
  const spreadBox = await spreadOptions.boundingBox();
  const viewport = page.viewportSize();
  if (!spreadBox || !viewport) throw new Error("The centered spread selector must be measurable.");
  expect(Math.abs(spreadBox.x + spreadBox.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
  await captureGuestReview(page, testInfo, "free-reading-selection");
  await page.getByRole("button", { name: /Continue with Three-Card Spread/ }).click();
  await page.getByRole("button", { name: "Reduce motion" }).click();
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByText(/Use a general reading instead/i)).toHaveCount(0);
  await page.getByLabel("Your birthday").fill("1990-01-15");
  await page.getByLabel(/I agree to the Terms/i).check();
  await page.getByLabel(/I have read the Privacy Notice/i).check();
  await page.getByLabel(/I confirm that I am at least 18/i).check();
  await page
    .getByLabel("Your private guest question")
    .fill("What can I understand about the next step in my work?");

  const creation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/guest-readings",
  );
  await page.getByRole("button", { name: "Begin my free reading" }).click();
  expect((await creation).status()).toBe(201);

  await revealGuestCards(page);
  await captureGuestReview(page, testInfo, "free-reading-result-gate");
  const originalCards = await page
    .getByTestId("tarot-spread-stage")
    .locator(".physical-tarot-card")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-card-id")));
  expect(originalCards).toHaveLength(3);

  // Remove display recovery and the redundant local allowance marker while
  // retaining the encrypted receipt, browser device ID, and HttpOnly cookie.
  // The server marker alone should now route the browser to account conversion.
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.removeItem("sg:guest-trial-used:v1");
  });
  await page.goto("/free-reading");
  await expect(
    page.getByRole("heading", { name: "Keep going inside a private account." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sign up", exact: true }).click();
  await expect(page).toHaveURL(/\/sign-up\?next=/);

  await page.getByLabel("Email").fill(`guest-${randomUUID()}@example.test`);
  await page.getByLabel("Display name").fill("Nova");
  await page.getByLabel(/^Password/).fill("synthetic-private-password");
  await page.getByLabel("Confirm password").fill("synthetic-private-password");
  await page.getByRole("button", { name: "Continue to privacy commitments" }).click();
  await page.getByLabel(/I agree to the versioned Terms/i).check();
  await page.getByLabel(/I have read the versioned Privacy Notice/i).check();
  await page.getByLabel(/I confirm that I am at least 18/i).check();
  await page.getByRole("button", { name: "Create private account" }).click();

  await expect(page).toHaveURL(/\/free-reading\?continue=1$/, { timeout: 20_000 });
  await expect(page.getByText("Same cards · account unlocked")).toBeVisible({ timeout: 20_000 });
  const recoveredCards = await page
    .getByTestId("tarot-spread-stage")
    .locator(".physical-tarot-card")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-card-id")));
  expect(recoveredCards).toEqual(originalCards);

  await page
    .getByLabel("Ask these same cards one follow-up")
    .fill("What is one practical way to meet that next step?");
  await page.getByRole("button", { name: "Ask the same cards" }).click();
  await expect(page.getByRole("heading", { name: "One more edge comes into view." })).toBeVisible();
  await expect(page.getByText(/did not alter the cards/i)).toBeVisible();
});
