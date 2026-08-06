import { randomUUID } from "node:crypto";
import path from "node:path";

import { expect, test } from "@playwright/test";

test("capture the completed reading for reviewer evidence", async ({ page }, testInfo) => {
  test.skip(!process.env.CAPTURE_SCREENSHOTS, "Run explicitly when updating review screenshots.");
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`screenshot-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("synthetic-private-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Full birth name").fill("Ada Lovelace");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  await page.getByLabel("Your private question").fill("What can support my next grounded step?");
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  // Cut and reveal are intentional user actions (PRD UX-004/UX-006), not
  // timers — drive past them the same way mvp.spec.ts's finishRitual() does.
  await page
    .getByRole("button", { name: "Finish shuffling", exact: true })
    .click({ timeout: 2_000 })
    .catch(() => {});
  await page.getByRole("button", { name: "Skip cut", exact: true }).click();
  await page.getByRole("button", { name: "Reveal all", exact: true }).click();
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Next reading passage" })).toBeEnabled();
  await page.getByRole("button", { name: "Next reading passage" }).click();
  await expect(page.locator('.oracle-entry[data-phase="cardInterpretation"]')).toBeVisible();
  await expect(page.locator(".physical-card-figure.is-reading-subject")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: path.resolve(
      process.cwd(),
      "../../docs/screenshots",
      `sanctuary-reading-${testInfo.project.name}.png`,
    ),
  });
});
