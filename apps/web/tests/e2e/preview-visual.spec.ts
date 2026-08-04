import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoBlockingAccessibilityViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual(
    [],
  );
}

test("the visual preview follows the streamlined result and continuation sequence", async ({
  page,
}) => {
  await page.goto("/visual-preview");
  const journey = page.getByTestId("oracle-transcript");
  await expect(page.getByRole("heading", { name: "Opening theme" })).toBeVisible();
  await expect(page.getByTestId("reading-journey")).toHaveAttribute(
    "data-loaded-section-count",
    "10",
  );

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "Next reading section" }).click();
    await expect(journey).toHaveAttribute("data-active-card-index", String(index));
  }
  await expectNoBlockingAccessibilityViolations(page);

  await journey.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("heading", { name: "The Cards Answer" })).toBeVisible();
  await page.getByRole("button", { name: "Previous reading section" }).click();
  await expect(page.getByRole("heading", { name: "Starlit Reflection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reading details" })).toHaveCount(0);
  await expectNoBlockingAccessibilityViolations(page);
});

test("capture the sanctuary from the Netlify Deploy Preview", async ({ page }, testInfo) => {
  test.skip(!process.env.PREVIEW_SCREENSHOTS, "Run only against the deployed preview URL.");
  await page.goto("/visual-preview");
  await expect(page.getByTestId("mystic-sanctuary-scene")).toBeVisible();
  await expect(page.locator(".physical-tarot-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Next reading section" }).click();
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
