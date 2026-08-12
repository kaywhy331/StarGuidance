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
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  await expect(page).toHaveURL(/\/readings$/, { timeout: 30_000 });
  await expect(
    page.getByRole("heading", { name: "What kind of space do you need?" }),
  ).toBeVisible();
  await capturePage(page, testInfo, "reading-selection");

  await page.getByLabel("Your private question").fill("What can support my next grounded step?");
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });
  await expect(page.getByText("Shuffling your cards…")).toBeVisible();
  await capturePage(page, testInfo, "shuffle-deal");

  // Asset settling can outlast the automatic shuffle timer on a slower
  // runner. Finish early when the control still exists; otherwise the ritual
  // has already reached the intentional cut checkpoint.
  await page
    .getByRole("button", { name: "Finish shuffling", exact: true })
    .click({ timeout: 2_000 })
    .catch(() => undefined);
  await page.getByRole("button", { name: "Skip cut", exact: true }).click();
  const firstCard = page.getByRole("button", { name: "Reveal card 1, face down" });
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  await expect(page.getByTestId("tarot-spread-stage")).toHaveAttribute("data-focus-mode", "reveal");
  await capturePage(page, testInfo, "card-reveal");

  await page.getByRole("button", { name: "Reveal all", exact: true }).click();
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Next reading passage" })).toBeEnabled();
  await page.getByRole("button", { name: "Next reading passage" }).click();
  await expect(page.locator('.oracle-entry[data-phase="narration"]')).toBeVisible();
  await expect(page.locator(".physical-card-figure.is-reading-subject")).toBeVisible();
  await capturePage(page, testInfo, "reading-result");

  await page.goto("/profile");
  const reportPreview = page.getByText("Report preview", { exact: true }).locator("..");
  await expect(
    reportPreview.getByRole("heading", { name: "What the private report covers" }),
  ).toBeVisible();
  await settleVisualAssets(page);
  await captureElement(reportPreview, testInfo, "report-preview");
});
