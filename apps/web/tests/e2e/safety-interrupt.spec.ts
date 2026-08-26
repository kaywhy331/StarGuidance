import { expect, test } from "@playwright/test";

import { createAccountAndProfileViaApi, revealAllThroughUi } from "./reading-helpers";

test("a crisis-flagged question interrupts before question confirmation or draw preparation", async ({
  page,
}) => {
  await createAccountAndProfileViaApi(page);
  await page.getByLabel("Your private question").fill("I want to die");
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === "/api/readings",
  );
  await page.getByRole("button", { name: "Review my question" }).click();
  expect((await response).status()).toBe(422);

  await expect(page.getByTestId("safety-interrupt-panel")).toBeVisible();
  await expect(page.getByLabel("Your private question")).toHaveCount(0);
  await expect(page.getByText(/call emergency services now/i)).toBeVisible();
  await expect(page.getByText(/Immediate support/)).toBeVisible();
  await expect(page.locator(".safety-interrupt-resources li").first()).toBeVisible();
  await expect(page.getByTestId("spread-position-preview")).toHaveCount(0);
});

test("a guarded question is acknowledged before the commitment and can continue as reflection", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await createAccountAndProfileViaApi(page);
  await page.getByLabel("Your private question").fill("Should I buy or sell this stock?");
  await page.getByRole("button", { name: "Review my question" }).click();
  await page.getByRole("button", { name: "Confirm this question" }).click();

  const preflightResponse = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === "/api/readings" &&
      candidate.request().postData()?.includes('"action":"prepare"') === true,
  );
  await page
    .getByRole("button", { name: "Confirm Three Cards — Situation, Challenge, Direction" })
    .click();
  const preflight = await preflightResponse;
  expect(preflight.status()).toBe(409);
  expect(await preflight.json()).not.toHaveProperty("readingId");
  await expect(page.getByText(/The cards cannot establish this as fact/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Begin the shuffle" })).toHaveCount(0);

  const acknowledgedResponse = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === "/api/readings" &&
      candidate.status() === 201,
  );
  await page.getByRole("button", { name: "Continue as reflection", exact: true }).click();
  const acknowledged = await acknowledgedResponse;
  expect(acknowledged.status()).toBe(201);
  expect(JSON.stringify(await acknowledged.json())).not.toMatch(/"cardId"|"assignments"/);

  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  await page.getByRole("button", { name: "Finish shuffling" }).click();
  await page.getByRole("button", { name: "Continue without a cut" }).click();
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });
  await revealAllThroughUi(page);
  await expect(page.getByTestId("reading-journey")).toHaveAttribute("data-state", "complete", {
    timeout: 30_000,
  });
  await page.getByTestId("oracle-transcript").press("End");
  await page.getByTestId("complete-reading-action").click();
  await expect(
    page.getByText("This reading offers user-centered reflection rather than a factual claim."),
  ).toBeVisible();
});
