import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

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

async function createReading(page: Page): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`a11y-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue privately" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByLabel("Full birth name").fill("Accessible Synthetic");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  await expect(page).toHaveURL(/\/readings$/, { timeout: 30_000 });
  await page.getByLabel("Your private question").fill("What should I notice now?");
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });
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
});
