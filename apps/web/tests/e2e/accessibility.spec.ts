import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function applyTwoHundredPercentText(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
}

async function expectHorizontalReflow(page: Page): Promise<void> {
  const evidence = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const documentOverflow =
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewportWidth;
    const clipped = [
      ...document.querySelectorAll<HTMLElement>("a,button,input,textarea,select,[tabindex]"),
    ]
      .filter(
        (element) => !element.classList.contains("skip-link") && element.offsetParent !== null,
      )
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && (bounds.left < -1 || bounds.right > viewportWidth + 1);
      })
      .map((element) => `${element.tagName.toLowerCase()}#${element.id || "unidentified"}`);
    return { documentOverflow, clipped };
  });
  expect(
    evidence.documentOverflow,
    "the document must not require horizontal scrolling",
  ).toBeLessThanOrEqual(1);
  expect(evidence.clipped, "interactive controls must remain inside the viewport").toEqual([]);
}

async function reachOnboarding(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`a11y-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("synthetic-private-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/consent$/);
  await page.getByLabel(/I accept the current Terms/i).check();
  await page.getByLabel(/I have read the current Privacy Notice/i).check();
  await page.getByLabel(/I confirm that I am at least 18/i).check();
  await page.getByRole("button", { name: "Accept and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function createReading(page: Page): Promise<void> {
  await reachOnboarding(page);
  await page.getByLabel("Full birth name").fill("Accessible Synthetic");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  await page.getByRole("button", { name: "Continue to optional context" }).click();
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  await expect(page).toHaveURL(/\/readings$/, { timeout: 30_000 });
  await page.getByRole("button", { name: /^Continue with / }).click();
  await page.getByLabel("Your private question").fill("What should I notice now?");
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });
  // Keep the accessibility suite fast while exercising the same centered,
  // reader-controlled sequence through standard buttons.
  const motionControl = page.getByRole("button", { name: /^Reduced motion/ });
  if ((await motionControl.getAttribute("aria-pressed")) !== "true") await motionControl.click();
  await expect(motionControl).toHaveAttribute("aria-pressed", "true");
  const sanctuary = page.getByTestId("mystic-sanctuary-scene");
  await expect(sanctuary).toHaveAttribute("data-reduced-motion", "true");
  const gather = page.getByRole("button", { name: "Gather now", exact: true });
  if (await gather.isVisible()) await gather.dispatchEvent("click").catch(() => {});
  await expect(sanctuary).toHaveAttribute("data-ritual-phase", "awaitingReveal", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("question-reflection")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "I’m ready", exact: true }).dispatchEvent("click");
  for (let index = 0; index < 10; index += 1) {
    const faceDownCard = page.getByRole("button", { name: /^Reveal card \d+, face down$/ }).first();
    await expect(faceDownCard).toBeVisible();
    await faceDownCard.dispatchEvent("click");
    const action = page.locator(".guided-next-action");
    await expect(action).toBeVisible();
    const finalCard = (await action.textContent())?.includes("Continue to your reading") === true;
    await action.dispatchEvent("click");
    if (finalCard) break;
  }
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 30_000 });
}

test("skip navigation and keyboard focus remain visibly operable", async ({ page }) => {
  await page.goto("/sign-in");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  const focusStyle = await skip.evaluate((element) => {
    const style = getComputedStyle(element);
    return { width: Number.parseFloat(style.outlineWidth), style: style.outlineStyle };
  });
  expect(focusStyle.style).not.toBe("none");
  expect(focusStyle.width).toBeGreaterThanOrEqual(2);
  await page.keyboard.press("Enter");
  await expect(page.locator("#main-content")).toBeFocused();
});

test("onboarding exposes valid automated WCAG semantics", async ({ page }) => {
  await reachOnboarding(page);
  await expect(page.getByLabel("Core profile completeness")).toHaveAttribute("role", "meter");
  await expect(page.getByLabel("Core profile completeness")).toHaveAttribute("aria-valuenow", "1");

  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(
    violations
      .filter(({ impact }) => impact === "critical" || impact === "serious")
      .map(({ id }) => id),
  ).toEqual([]);
});

test("200% text reflows public, onboarding, and completed-reading controls at 320px", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/sign-in");
  await applyTwoHundredPercentText(page);
  await expectHorizontalReflow(page);

  await createReading(page);
  await applyTwoHundredPercentText(page);
  await expectHorizontalReflow(page);
  const transcript = page.getByTestId("oracle-transcript");
  await transcript.focus();
  await expect(transcript).toBeFocused();
  await expect(transcript).toHaveCSS("outline-style", "solid");
  await expect(transcript).toHaveCSS("outline-width", "3px");

  await page.goto("/settings/privacy");
  await applyTwoHundredPercentText(page);
  await expectHorizontalReflow(page);
});
