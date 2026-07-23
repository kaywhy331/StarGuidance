import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test } from "@playwright/test";

test("capture the completed reading for reviewer evidence", async ({ page }, testInfo) => {
  test.skip(!process.env.CAPTURE_SCREENSHOTS, "Run explicitly when updating review screenshots.");
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`screenshot-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue privately" }).click();
  await page.getByLabel("Full birth name").fill("Ada Lovelace");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  await page.getByLabel("Your private question").fill("What can support my next grounded step?");
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  await page.getByRole("button", { name: "Finish shuffling" }).click();
  await page.getByRole("button", { name: "Skip cut" }).click();
  await page.getByRole("button", { name: "Reveal all" }).click();
  await page.getByRole("button", { name: "Open the reading" }).click();
  await expect(page.getByText("Central theme")).toBeVisible();
  await page.screenshot({
    fullPage: true,
    path: path.resolve(
      process.cwd(),
      "../../docs/screenshots",
      `completed-reading-${testInfo.project.name}.png`,
    ),
  });
});
