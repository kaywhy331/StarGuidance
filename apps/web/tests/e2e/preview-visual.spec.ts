import path from "node:path";

import { expect, test } from "@playwright/test";

test("capture the sanctuary from the Netlify Deploy Preview", async ({ page }, testInfo) => {
  test.skip(!process.env.PREVIEW_SCREENSHOTS, "Run only against the deployed preview URL.");
  await page.goto("/visual-preview");
  await expect(page.getByTestId("mystic-sanctuary-scene")).toBeVisible();
  await expect(page.locator(".physical-tarot-card")).toHaveCount(3);
  await expect(
    page.locator(
      '.oracle-entry[data-phase="uncertainty"] .oracle-entry-text > span[aria-hidden="true"]',
    ),
  ).toContainText(/Tarot is reflective guidance, not factual proof/i);
  await page.screenshot({
    animations: "disabled",
    path: path.resolve(
      process.cwd(),
      "../../docs/screenshots",
      `sanctuary-reading-${testInfo.project.name}.png`,
    ),
  });
});
