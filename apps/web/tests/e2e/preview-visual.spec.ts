import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { monotonicVisibleWordCount } from "../../src/app/session/[id]/oracle-transcript";

async function expectNoBlockingAccessibilityViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual(
    [],
  );
}

async function expectHorizontallyCentered(page: Page, selector: string) {
  let lastMeasurement: Record<string, unknown> | undefined;
  try {
    await expect
      .poll(async () => {
        const [bounds, contentBounds, sanctuaryBounds, stackBounds] = await Promise.all([
          page.locator(selector).boundingBox(),
          page.locator(".sanctuary-content").boundingBox(),
          page.getByTestId("mystic-sanctuary-scene").boundingBox(),
          page.locator(".oracle-console-stack").boundingBox(),
        ]);
        lastMeasurement = {
          bounds,
          contentBounds,
          sanctuaryBounds,
          selector,
          stackBounds,
          viewport: page.viewportSize(),
        };
        if (!bounds || !sanctuaryBounds) return Number.POSITIVE_INFINITY;
        return Math.abs(
          bounds.x + bounds.width / 2 - (sanctuaryBounds.x + sanctuaryBounds.width / 2),
        );
      })
      .toBeLessThanOrEqual(3);
  } catch (error) {
    throw new Error(
      `Horizontal centering failed: ${JSON.stringify(lastMeasurement)}\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

test("narration reveal progress remains monotonic", () => {
  expect(monotonicVisibleWordCount(5, 2, 9)).toBe(5);
  expect(monotonicVisibleWordCount(5, 7, 9)).toBe(7);
  expect(monotonicVisibleWordCount(8, 12, 9)).toBe(9);
});

test("the visual preview renders the spread-aware result and evidence contract", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const mobileViewport = testInfo.project.name.startsWith("mobile");
  await page.setViewportSize(
    mobileViewport ? { width: 393, height: 852 } : { width: 1440, height: 900 },
  );
  await page.goto("/visual-preview");

  const sanctuary = page.getByTestId("mystic-sanctuary-scene");
  await expect(sanctuary).toBeVisible();
  await expect(sanctuary).toHaveAttribute("data-backdrop", "starry-reading");
  await expect(sanctuary).toHaveAttribute("data-reading-focus", "reading");
  await expect
    .poll(() =>
      sanctuary
        .locator(".sanctuary-background img")
        .evaluate((image: HTMLImageElement) => image.currentSrc),
    )
    .toContain(`/art/reading/starry-night-${mobileViewport ? "mobile" : "desktop"}-v1.`);
  await expect(page.locator("canvas")).toHaveCount(0);
  const atmosphericTransferBytes = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter(({ name }) => name.includes("/art/reading/starry-night-"))
      .reduce((total, entry) => total + (entry as PerformanceResourceTiming).transferSize, 0),
  );
  expect(atmosphericTransferBytes).toBeGreaterThan(0);
  expect(atmosphericTransferBytes).toBeLessThan(350_000);
  await expect(page.getByTestId("tarot-spread-stage")).toBeVisible();
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(3);
  await expect(page.locator(".question-composer")).toHaveCount(0);
  await expect(page.getByTestId("reading-journey")).toHaveAttribute(
    "data-loaded-section-count",
    "8",
  );
  await expect(page.getByTestId("reading-journey")).toHaveAttribute("data-reading-mode", "section");
  await expect(page.getByRole("heading", { name: "Your answer", exact: true })).toBeVisible();
  await expect(page.getByText(/a careful change is already taking shape/i)).toHaveCount(1);
  await expect(page.getByTestId("reading-active-passage")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Situation" })).toHaveCount(0);
  await expectHorizontallyCentered(page, '[data-testid="oracle-transcript"]');

  const details = page.locator(".reading-details-drawer");
  await details.locator("summary").click();
  await expect(details.getByRole("listitem")).toHaveCount(9);
  await expect(details).toContainText("approved upright themes");
  await expect(details).toContainText("approved reversed themes");
  await expect(details).toContainText("This reading uses only the locked cards");

  await page.getByRole("button", { name: "Next reading passage" }).click();
  await expect(page.getByRole("heading", { name: "Situation" })).toBeVisible();
  await expect(page.getByTestId("oracle-transcript")).toHaveAttribute(
    "data-active-card-index",
    "0",
  );
  await page.getByRole("button", { name: "Next reading passage" }).click();
  await expect(page.getByRole("heading", { name: "Challenge" })).toBeVisible();
  await expect(page.getByTestId("oracle-transcript")).toHaveAttribute(
    "data-active-card-index",
    "1",
  );

  const transcript = page.getByTestId("oracle-transcript");
  await transcript.focus();
  await page.keyboard.press("End");
  await expect(transcript).toBeFocused();
  await expect(page.getByRole("button", { name: "Finish reading" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Previous reading passage" })).toBeEnabled();
  await expect(page.getByText("8 of 8", { exact: true })).toBeVisible();
  await expect(page.locator(".question-composer")).toHaveCount(0);
  await expectNoBlockingAccessibilityViolations(page);
  await page.getByRole("button", { name: "Finish reading" }).click();
  await expect(sanctuary).toHaveAttribute("data-reading-focus", "actions");
  await expect(page.getByTestId("oracle-transcript")).toHaveCount(0);
  await expect(page.locator(".question-composer")).toBeVisible();
  await expectHorizontallyCentered(page, ".question-composer");
  await expectNoBlockingAccessibilityViolations(page);
});

test("capture the sanctuary from the Netlify Deploy Preview", async ({ page }, testInfo) => {
  test.skip(!process.env.PREVIEW_SCREENSHOTS, "Run only against the deployed preview URL.");
  await page.goto("/visual-preview");
  await expect(page.getByTestId("reading-active-passage")).toBeVisible();
  await page.getByRole("button", { name: "Next reading passage" }).click();
  await page.getByRole("button", { name: "Next reading passage" }).click();
  await expect(page.getByTestId("oracle-transcript")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: path.resolve(
      process.cwd(),
      "../../docs/screenshots",
      `sanctuary-reading-${testInfo.project.name}.png`,
    ),
  });
});
