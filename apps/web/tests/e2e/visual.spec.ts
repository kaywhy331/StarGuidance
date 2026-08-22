import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

function screenshotPath(name: string, testInfo: TestInfo) {
  return path.resolve(
    process.cwd(),
    "../../docs/screenshots",
    `${name}-${testInfo.project.name}.png`,
  );
}

async function settleVisualAssets(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((asset) =>
        asset.complete ? Promise.resolve() : asset.decode().catch(() => undefined),
      ),
    );
  });
}

async function capturePage(page: Page, testInfo: TestInfo, name: string, fullPage = false) {
  await settleVisualAssets(page);
  await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage,
    path: screenshotPath(name, testInfo),
  });
}

async function captureElement(locator: Locator, testInfo: TestInfo, name: string) {
  await locator.screenshot({
    animations: "disabled",
    caret: "hide",
    path: screenshotPath(name, testInfo),
  });
}

test("capture the required reviewer journey", async ({ page }, testInfo) => {
  test.skip(!process.env.CAPTURE_SCREENSHOTS, "Run explicitly when updating review screenshots.");
  test.setTimeout(420_000);
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`screenshot-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("synthetic-private-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/consent$/);
  await page.getByLabel(/I accept the current Terms/i).check();
  await page.getByLabel(/I have read the current Privacy Notice/i).check();
  await page.getByLabel(/I confirm that I am at least 18/i).check();
  await page.getByRole("button", { name: "Accept and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("heading", { name: "Begin with what you know." })).toBeVisible();
  await capturePage(page, testInfo, "onboarding", true);

  await page.getByLabel("Full birth name").fill("Ada Lovelace");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  await page
    .getByRole("checkbox", { name: /I consent to the private use of my birth details/i })
    .check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/readings$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "What kind of space do you need?" }),
  ).toBeVisible();
  await capturePage(page, testInfo, "reading-selection");

  await page.getByRole("button", { name: /^Continue with / }).click();
  await page.getByLabel("Your private question").fill("What can support my next grounded step?");
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });
  await expect(page.getByText("Shuffling your cards", { exact: true })).toBeVisible();
  await capturePage(page, testInfo, "shuffle-deal");

  // Gather early for a deterministic capture while retaining the authored
  // two-second gather, one-second deal cadence, and five-second reflection.
  const gather = page.getByRole("button", { name: "Gather now", exact: true });
  if (await gather.isVisible())
    await gather.click({ force: true, timeout: 1_000 }).catch(() => undefined);
  await expect(page.getByTestId("question-reflection")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: "I’m ready", exact: true })).toBeVisible({
    timeout: 12_000,
  });
  await page.getByRole("button", { name: "I’m ready", exact: true }).click();
  await page.getByRole("button", { name: "Reveal card 1, face down" }).click();
  await expect(page.getByTestId("tarot-spread-stage")).toHaveAttribute("data-focus-mode", "reveal");
  await capturePage(page, testInfo, "card-reveal");

  for (let index = 0; index < 10; index += 1) {
    const action = page.locator(".guided-next-action");
    await expect(action).toBeVisible();
    const finalCard = (await action.textContent())?.includes("Continue to your reading") === true;
    await action.click();
    if (finalCard) break;
    await page
      .getByRole("button", { name: /^Reveal card \d+, face down$/ })
      .first()
      .click();
  }
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Next reading passage" })).toBeEnabled();
  await page.getByRole("button", { name: "Next reading passage" }).click();
  await expect(page.locator('.oracle-entry[data-phase="narration"]')).toBeVisible();
  await expect(
    page.locator('.oracle-entry[data-phase="narration"] .oracle-word:not(.is-visible)'),
  ).toHaveCount(0, { timeout: 12_000 });
  await expect(page.locator(".physical-card-figure.is-reading-subject")).toBeVisible();
  await capturePage(page, testInfo, "reading-result");

  await page.goto("/profile");
  const reportPreview = page.locator(".profile-report-preview");
  await expect(
    reportPreview.getByRole("heading", { name: "Your full pattern atlas" }),
  ).toBeVisible();
  await settleVisualAssets(page);
  await captureElement(reportPreview, testInfo, "report-preview");

  await reportPreview.getByRole("button", { name: "Open your full atlas" }).click();
  await expect(page).toHaveURL(/\/report\/[a-f0-9-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Your private pattern atlas" })).toBeVisible();
  await capturePage(page, testInfo, "pattern-atlas");
});
