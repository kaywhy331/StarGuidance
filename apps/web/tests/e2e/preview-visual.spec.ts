import path from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import {
  monotonicVisibleWordCount,
  NARRATION_TIMING,
} from "../../src/app/session/[id]/oracle-transcript";

async function expectNoBlockingAccessibilityViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  expect(violations.filter(({ impact }) => impact === "critical" || impact === "serious")).toEqual(
    [],
  );
}

async function expectHorizontallyCentered(page: Page, selector: string) {
  await expect
    .poll(async () => {
      const bounds = await page.locator(selector).boundingBox();
      const viewport = page.viewportSize();
      if (!bounds || !viewport) return Number.POSITIVE_INFINITY;
      return Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2);
    })
    .toBeLessThanOrEqual(3);
}

async function expectCardAboveReading(page: Page) {
  await expect
    .poll(async () => {
      const card = await page.locator(".physical-card-figure.is-reading-subject").boundingBox();
      const reading = await page.getByTestId("oracle-transcript").boundingBox();
      if (!card || !reading) return Number.NEGATIVE_INFINITY;
      return reading.y - (card.y + card.height);
    })
    .toBeGreaterThanOrEqual(2);
}

async function expectLayeredReadingWindow(page: Page) {
  await expect
    .poll(async () => {
      const bounds = await page.getByTestId("oracle-transcript").boundingBox();
      const viewport = page.viewportSize();
      if (!bounds || !viewport) return Number.NEGATIVE_INFINITY;
      return bounds.height / viewport.height;
    })
    .toBeGreaterThanOrEqual(0.38);
  await expect
    .poll(async () => {
      const bounds = await page.getByTestId("oracle-transcript").boundingBox();
      const viewport = page.viewportSize();
      if (!bounds || !viewport) return Number.POSITIVE_INFINITY;
      return bounds.height / viewport.height;
    })
    .toBeLessThanOrEqual(0.65);
}

test("narration always advances visually and starts with a readable lead", () => {
  expect(monotonicVisibleWordCount(5, 2, 9)).toBe(5);
  expect(monotonicVisibleWordCount(5, 7, 9)).toBe(7);
  expect(monotonicVisibleWordCount(8, 12, 9)).toBe(9);
  expect(NARRATION_TIMING.boundaryLeadWords).toBeGreaterThanOrEqual(2);
  expect(
    NARRATION_TIMING.maxSilentRevealSteps * NARRATION_TIMING.silentWordIntervalMs,
  ).toBeLessThanOrEqual(1_500);
  expect(NARRATION_TIMING.speechStartDelayMs).toBeGreaterThan(
    NARRATION_TIMING.spokenWordIntervalMs,
  );
});

test("the visual preview follows the streamlined result and continuation sequence", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  const mobileViewport = testInfo.project.name.startsWith("mobile");
  await page.setViewportSize(
    mobileViewport ? { width: 393, height: 852 } : { width: 1440, height: 900 },
  );
  await page.goto("/visual-preview");
  await expect
    .poll(() => page.evaluate(() => window.sessionStorage.getItem("ntl-drawer-initial-state")))
    .toBe("hidden");
  await expect(page.locator('iframe[title="Netlify Drawer"]')).toHaveCount(0);
  const journey = page.getByTestId("oracle-transcript");
  await expect(
    page.getByRole("heading", { name: "The quiet architecture of change" }),
  ).toBeVisible();
  await expect(page.getByTestId("reading-journey")).toHaveAttribute(
    "data-loaded-section-count",
    "10",
  );
  await expect(page.getByText(/^Section \d+$/)).toHaveCount(0);
  await expectHorizontallyCentered(page, '[data-testid="oracle-transcript"]');
  await expectHorizontallyCentered(page, ".question-composer");
  await expectLayeredReadingWindow(page);

  const overview = page.getByTestId("reading-result-overview");
  await expect(overview).toBeVisible();
  await expect(overview).toHaveCSS("text-align", "center");
  await expect(overview.getByRole("heading", { name: "Cards in this thread" })).toBeVisible();
  const lockedCards = overview.locator(".reading-card-strip button");
  await expect(lockedCards).toHaveCount(3);
  await expect(lockedCards.first().locator("small")).not.toBeEmpty();
  await expect(lockedCards.first().locator("strong")).not.toBeEmpty();
  await expect(lockedCards.first().locator("span:not(.sr-only)")).toHaveText(/upright|reversed/);

  const titleMetrics = await overview.locator(".reading-result-header h2").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      fontSize: Number.parseFloat(style.fontSize),
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });
  expect(titleMetrics.fontSize).toBeGreaterThanOrEqual(26);
  expect(titleMetrics.fontSize).toBeLessThanOrEqual(52);
  expect(titleMetrics.lineHeight / titleMetrics.fontSize).toBeLessThanOrEqual(1.12);

  const narrativeSize = await overview
    .locator(".reading-result-header > .oracle-entry-text")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(narrativeSize).toBeGreaterThanOrEqual(mobileViewport ? 17 : 18);
  await expect(overview.locator(".oracle-cursor")).toHaveCount(0);
  await expect(overview.locator(".oracle-word").first()).toHaveCSS("filter", "none");
  const composerTextSize = await page
    .locator(".question-composer-field textarea")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(composerTextSize).toBeGreaterThanOrEqual(16);
  const composerHint = page.locator(".question-composer-hint");
  await expect(composerHint).toBeVisible();
  const composerHintSize = await composerHint.evaluate((element) =>
    Number.parseFloat(getComputedStyle(element).fontSize),
  );
  expect(composerHintSize).toBeGreaterThanOrEqual(14);

  await expect(page.getByText("Explore the complete interpretation", { exact: true })).toHaveCount(
    0,
  );

  for (let index = 0; index < 3; index += 1) {
    await page.getByRole("button", { name: "Next reading passage" }).click();
    await expect(journey).toHaveAttribute("data-active-card-index", String(index));
    await expectHorizontallyCentered(page, ".physical-card-figure.is-reading-subject");
    await expectCardAboveReading(page);
    if (index === 1) {
      await expect(page.getByRole("heading", { name: "Wheel of Fortune (R)" })).toHaveCount(0);
      const reversedArtwork = page
        .locator(".physical-card-figure.is-reading-subject .physical-card-front img")
        .first();
      await expect(reversedArtwork).toHaveClass(/card-art-reversed/);
      const rotation = await reversedArtwork.evaluate((element) => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform);
        return { a: matrix.a, d: matrix.d };
      });
      expect(rotation.a).toBeLessThan(0);
      expect(rotation.d).toBeLessThan(0);
    }
  }
  await expect(page.locator(".physical-card-figure figcaption:not(.sr-only)")).toHaveCount(0);
  await expectNoBlockingAccessibilityViolations(page);

  await journey.focus();
  await page.keyboard.press("End");
  const integration = page.getByTestId("reading-integration");
  await expect(integration).toBeVisible();
  for (const heading of ["Your agency", "Conditions to notice", "What could change the pattern"])
    await expect(integration.getByRole("heading", { name: heading })).toBeVisible();
  await expect(integration.locator(".reading-uncertainty")).toBeVisible();
  await page.getByRole("button", { name: "Previous reading passage" }).click();
  await expect(page.getByRole("heading", { name: "Starlit Reflection" })).toHaveCount(0);
  await expect(page.locator(".oracle-entry-text")).toBeVisible();
  await expect(page.getByTestId("reading-result-overview")).toHaveCount(0);
  await expectNoBlockingAccessibilityViolations(page);
});

test("capture the sanctuary from the Netlify Deploy Preview", async ({ page }, testInfo) => {
  test.skip(!process.env.PREVIEW_SCREENSHOTS, "Run only against the deployed preview URL.");
  await page.goto("/visual-preview");
  await expect(page.getByTestId("mystic-sanctuary-scene")).toBeVisible();
  await expect(page.locator(".physical-tarot-card")).toHaveCount(3);
  await page.getByRole("button", { name: "Next reading passage" }).click();
  await expect(page.locator('.oracle-entry[data-phase="narration"]')).toBeVisible();
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
