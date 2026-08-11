import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

async function signInWithoutCurrentConsent(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`settings-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("synthetic-private-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/consent$/, { timeout: 20_000 });
}

async function acceptCurrentPolicies(page: Page) {
  await page.getByLabel(/I accept the current Terms/i).check();
  await page.getByLabel(/I have read the current Privacy Notice/i).check();
  await page.getByLabel(/I confirm that I am at least 18/i).check();
  await page.getByRole("button", { name: "Accept and continue" }).click();
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
}

test("an account missing current receipts must re-consent before protected creation", async ({
  page,
}) => {
  await signInWithoutCurrentConsent(page);
  await expect(page.getByRole("heading", { name: "Before you continue" })).toBeVisible();

  const blocked = await page.evaluate(async () => {
    const response = await fetch("/api/readings", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({
        spreadId: "direction",
        question: "What can support a grounded next step?",
      }),
    });
    return { body: await response.json(), status: response.status };
  });
  expect(blocked.status).toBe(428);
  expect(blocked.body).toMatchObject({
    error: "Review the current service policies before starting a reading.",
  });

  await acceptCurrentPolicies(page);
});

test("display identity, reading preferences, and reversible marketing consent persist", async ({
  page,
}) => {
  await signInWithoutCurrentConsent(page);
  await acceptCurrentPolicies(page);
  await page.goto("/settings/account");

  const displayName = page.getByLabel("Display name");
  const reducedMotion = page.getByLabel(/Reduce card and scene motion/i);
  const sound = page.getByLabel(/Enable optional reading sounds/i);
  const marketing = page.getByLabel(/Send occasional product news/i);
  await expect(displayName).toHaveValue("Reader");
  await displayName.fill("Nova");
  await reducedMotion.check();
  await sound.check();
  await marketing.check();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Account settings saved.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("Nova");
  await expect(page.getByLabel(/Reduce card and scene motion/i)).toBeChecked();
  await expect(page.getByLabel(/Enable optional reading sounds/i)).toBeChecked();
  await expect(page.getByLabel(/Send occasional product news/i)).toBeChecked();

  await page.getByLabel(/Send occasional product news/i).uncheck();
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Account settings saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel(/Send occasional product news/i)).not.toBeChecked();

  const exportPayload = await page.evaluate(async () => {
    const response = await fetch("/api/privacy/export", { cache: "no-store" });
    return response.json();
  });
  expect(exportPayload.account.consentRecords).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ policy: "marketing", withdrawnAt: expect.any(String) }),
    ]),
  );

  await page.goto("/onboarding");
  await page.getByLabel("Full birth name").fill("Synthetic Reference");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  await expect(page).toHaveURL(/\/readings$/, { timeout: 30_000 });
  await expect(page.getByText("For Nova", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Reduced motion/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("button", { name: /Sound/i })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
