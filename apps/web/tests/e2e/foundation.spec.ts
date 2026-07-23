import { expect, test } from "@playwright/test";

test("landing page explains private personalization and draw integrity", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("genuinely random draw");
  await expect(page.getByText(/never which cards appear/i)).toBeVisible();
});
