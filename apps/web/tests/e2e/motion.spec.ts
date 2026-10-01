import { expect, test, type Locator } from "@playwright/test";

import {
  createAccountAndProfileViaApi,
  finalizeReadingViaApi,
  prepareReadingViaApi,
  reviewAndConfirmQuestion,
  type PreparedCeremony,
} from "./reading-helpers";

/** Where the element's top edge sits, and whether it is hovered, on every
 * rendered frame for at least `durationMs` (and at least four frames). */
function frameSamples(locator: Locator, durationMs: number) {
  return locator.evaluate(async (element, duration) => {
    const samples: { top: number; hovered: boolean }[] = [];
    const end = performance.now() + duration;
    while (performance.now() < end || samples.length < 4) {
      await new Promise(requestAnimationFrame);
      samples.push({
        top: element.getBoundingClientRect().top,
        hovered: element.matches(":hover"),
      });
    }
    return samples;
  }, durationMs);
}

test("quiet mode persists across routes and the live device preference takes precedence", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Reduce motion across StarGuidance" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.getByRole("link", { name: "Free Reading", exact: true }).click();
  await expect(page.getByRole("button", { name: "Motion: Reduced" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await page.getByRole("button", { name: "Motion: Reduced" }).click();
  await expect(page.getByRole("button", { name: "Motion: Full" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page.getByRole("button", { name: "Motion: Reduced (device setting)" }),
  ).toBeDisabled();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBe(0);
  await expect(page.getByLabel("Your birthday")).toBeVisible();
});

test("the motion control works even when browser preference storage is blocked", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Storage blocked", "SecurityError");
    };
  });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: "Reduce motion across StarGuidance" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await expect(page.getByLabel("Email")).toBeVisible();
});

test("quiet mode synchronizes between open tabs, including cleared preferences", async ({
  context,
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  const otherPage = await context.newPage();
  await otherPage.emulateMedia({ reducedMotion: "no-preference" });
  await otherPage.goto("/");
  const toggle = page.getByRole("button", { name: "Reduce motion across StarGuidance" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(otherPage.locator("html")).toHaveAttribute("data-motion", "reduced");
  await otherPage.evaluate(() => localStorage.removeItem("sg:reading:reduced-motion"));
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  await otherPage.close();
});

test("public content stays readable without JavaScript and decorative depth ignores touch", async ({
  page,
  browser,
  isMobile,
}) => {
  const staticContext = await browser.newContext({
    javaScriptEnabled: false,
    viewport: { width: 390, height: 844 },
  });
  const staticPage = await staticContext.newPage();
  await staticPage.goto(new URL("/", test.info().project.use.baseURL).href);
  await expect(staticPage.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(staticPage.getByRole("link", { name: "Free Reading", exact: true })).toBeVisible();
  await expect(
    staticPage.getByRole("heading", { name: "Continue only if it helps" }),
  ).toBeVisible();
  await staticContext.close();

  await page.goto("/");
  const artwork = page.locator(".home-oracle");
  const before = await artwork.evaluate((element) => getComputedStyle(element).transform);
  await artwork.dispatchEvent("pointermove", { pointerType: "touch", clientX: 20, clientY: 20 });
  await expect
    .poll(() => artwork.evaluate((element) => getComputedStyle(element).transform))
    .toBe(before);
  if (!isMobile) {
    await artwork.hover({ position: { x: 20, y: 20 } });
    await expect
      .poll(() => artwork.evaluate((element) => getComputedStyle(element).transform))
      .not.toBe(before);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect
      .poll(() => artwork.evaluate((element) => getComputedStyle(element).transform))
      .toBe(before);
  }
});

test("a hovered button rises at most 2 px and stays under a pointer resting on its bottom edge", async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "full");
  const cta = page.getByRole("link", { name: "Free Reading", exact: true });
  await cta.scrollIntoViewIfNeeded();
  // The hero copy rises into place; measure the button once it is still.
  await expect
    .poll(async () => new Set((await frameSamples(cta, 300)).map(({ top }) => top)).size)
    .toBe(1);
  const rest = await cta.evaluate((element) => element.getBoundingClientRect().toJSON() as DOMRect);
  // A lift that carried the button off this last pixel row dropped hover,
  // which dropped the lift, which brought hover back — every frame.
  await page.mouse.move(rest.left + rest.width / 2, rest.bottom - 1);
  await frameSamples(cta, 500);
  const settled = await frameSamples(cta, 700);
  const tops = [...new Set(settled.map(({ top }) => top))];
  expect(tops).toHaveLength(1);
  const lift = rest.top - tops[0]!;
  if (isMobile) {
    // Touch has no hover state to acknowledge, so nothing lifts.
    expect(lift).toBeCloseTo(0, 2);
    return;
  }
  expect(settled.every(({ hovered }) => hovered)).toBe(true);
  expect(lift).toBeGreaterThan(0);
  expect(lift).toBeLessThanOrEqual(2.01);

  // Quiet mode keeps the hovered button exactly where it rests.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  const quiet = await frameSamples(cta, 500);
  expect(quiet.every(({ hovered }) => hovered)).toBe(true);
  for (const { top } of quiet) expect(top).toBeCloseTo(rest.top, 2);
});

test("a history card stays under a pointer resting on its bottom edge", async ({ page }) => {
  await createAccountAndProfileViaApi(page);
  await finalizeReadingViaApi(page, await prepareReadingViaApi(page));
  await page.goto("/history");
  const card = page.locator(".reading-memory-panel").first();
  await card.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => new Set((await frameSamples(card, 300)).map(({ top }) => top)).size)
    .toBe(1);
  const rest = await card.evaluate(
    (element) => element.getBoundingClientRect().toJSON() as DOMRect,
  );
  await page.mouse.move(rest.left + rest.width / 2, rest.bottom - 1);
  await frameSamples(card, 500);
  const settled = await frameSamples(card, 700);
  expect(settled.every(({ hovered }) => hovered)).toBe(true);
  expect(new Set(settled.map(({ top }) => top)).size).toBe(1);
});

test("bounded shuffle settles, restarts on intent, and all 78 fan cards remain keyboard selectable", async ({
  page,
}) => {
  // Match the existing multi-stage reading journeys: shared-runner WebKit can
  // spend most of 90 seconds on navigation and input before reaching resize.
  // Individual expectations retain their existing bounded timeouts.
  test.setTimeout(150_000);
  await createAccountAndProfileViaApi(page);
  await page.goto("/readings");
  const prepared = await reviewAndConfirmQuestion(
    page,
    "What can I understand about the next step in my work?",
  );
  expect(prepared.status()).toBe(201);
  const { ceremony } = (await prepared.json()) as { ceremony: PreparedCeremony };
  await expect(page.locator(".casino-card-shell")).toHaveCount(78);
  // Phase-specific legacy rules must not extend the new bounded atmosphere.
  await expect(page.locator(".sanctuary-light")).toHaveCSS("animation-duration", "3s");
  // Stirring restarts the wash on explicit input while the pile is on stage.
  await page.getByRole("button", { name: "Keep shuffling" }).click();
  const runningShellAnimations = () =>
    page
      .locator(".casino-card-shell")
      .evaluateAll(
        (elements) =>
          elements
            .flatMap((element) => element.getAnimations())
            .filter((animation) => animation.playState === "running").length,
      );
  await expect.poll(runningShellAnimations).toBeGreaterThan(0);
  // The wash re-stacks, hands the pile to the fan, and every finite entrance
  // settles without any further click.
  await expect(page.getByRole("button", { name: /^Choose face-down card / })).toHaveCount(78, {
    timeout: 20_000,
  });
  await expect.poll(runningShellAnimations, { timeout: 15_000 }).toBe(0);
  const first = page.getByRole("button", { name: "Choose face-down card 1", exact: true });
  await expect(first).toBeEnabled();
  await first.press("Enter");
  // A picked card must travel to the spread, including after a viewport resize.
  const picked = page.locator(".casino-card-shell.is-picked");
  const horizontalError = () =>
    picked.evaluate((element) => {
      const field = element.parentElement!.getBoundingClientRect();
      const card = element.getBoundingClientRect();
      const target = Number.parseFloat(getComputedStyle(element).getPropertyValue("--target-left"));
      return Math.abs(card.x + card.width / 2 - (field.x + (field.width * target) / 100));
    });
  await expect.poll(horizontalError).toBeLessThan(6);
  const verticalError = () =>
    picked.evaluate((element) => {
      const field = element.parentElement!.getBoundingClientRect();
      const card = element.getBoundingClientRect();
      const target = Number.parseFloat(
        getComputedStyle(element).getPropertyValue("--target-bottom"),
      );
      const targetCenter = field.bottom - (field.height * target) / 100 - element.clientHeight / 2;
      return Math.abs(card.y + card.height / 2 - targetCenter);
    });
  // The bottom-biased scale origin adds a few pixels of lift; a second
  // layout-position translation would instead send the card out of its slot.
  await expect.poll(verticalError).toBeLessThan(12);
  const viewport = page.viewportSize()!;
  await page.setViewportSize({
    width: Math.max(320, viewport.width - 60),
    height: viewport.height - 60,
  });
  await expect.poll(horizontalError).toBeLessThan(6);
  await expect.poll(verticalError).toBeLessThan(12);
  const remainingChoices = [78, 40, 2, 3, 4, 5, 6, 7, 8];
  for (const choice of remainingChoices.slice(0, ceremony.spread.positions.length - 1)) {
    await page
      .getByRole("button", { name: `Choose face-down card ${choice}`, exact: true })
      .press("Enter");
  }
  await page.getByRole("button", { name: "These are my cards" }).click();
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("button", { name: "I’m ready", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "I’m ready", exact: true }).click();
  await page.getByRole("button", { name: "Reveal card 1, face down" }).press("Enter");
  await expect(page.locator(".physical-card-front img")).toBeVisible();
  await page.getByRole("button", { name: /^Motion:/ }).click();
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(1);
  await expect(page.locator(".physical-card-inner").first()).toHaveCSS("transition-duration", "0s");
});
