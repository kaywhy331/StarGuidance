import { expect, test } from "@playwright/test";

test("landing page explains private personalization and draw integrity", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("genuinely random draw");
  await expect(page.getByText(/never which cards appear/i)).toBeVisible();
});

test("the primary threshold remains legible and contained on a mobile viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const primaryEntry = page.getByRole("link", { name: "Free Reading" });
  await expect(primaryEntry).toBeVisible();
  await expect(primaryEntry).toHaveAttribute("href", "/free-reading");
  await expect(page.getByRole("link", { name: "Sign up", exact: true })).toBeVisible();
  const presentation = await primaryEntry.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      color: style.color,
      backgroundImage: style.backgroundImage,
      overflow:
        Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
        document.documentElement.clientWidth,
    };
  });

  expect(presentation.color).toBe("rgb(19, 14, 27)");
  expect(presentation.backgroundImage).toContain("linear-gradient");
  expect(presentation.overflow).toBeLessThanOrEqual(1);
});
