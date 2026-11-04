import { expect, test } from "@playwright/test";

import { createAccountAndProfileViaApi, revealAllThroughUi } from "./reading-helpers";

test("a crisis-flagged question interrupts before draw preparation", async ({ page }) => {
  await createAccountAndProfileViaApi(page);
  await page.getByLabel("Your question for the stars").fill("I want to die");
  const response = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === "/api/readings",
  );
  await page.getByRole("button", { name: "Draw my cards" }).click();
  expect((await response).status()).toBe(422);

  await expect(page.getByTestId("safety-interrupt-panel")).toBeVisible();
  await expect(page.getByLabel("Your question for the stars")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Let’s set the cards down for a moment" }),
  ).toBeVisible();
  await expect(page.getByText(/call emergency services/i)).toBeVisible();
  await expect(page.getByText(/Immediate support/)).toBeVisible();
  await expect(page.locator(".safety-interrupt-resources li").first()).toBeVisible();
  await expect(page.getByTestId("spread-position-preview")).toHaveCount(0);
});

test("a guarded question is acknowledged before the commitment and can continue as reflection", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await createAccountAndProfileViaApi(page);
  const preflightResponse = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === "/api/readings" &&
      candidate.request().postData()?.includes('"action":"prepare"') === true,
  );
  await page.getByLabel("Your question for the stars").fill("Should I buy or sell this stock?");
  await page.getByRole("button", { name: "Draw my cards" }).click();
  const preflight = await preflightResponse;
  expect(preflight.status()).toBe(409);
  expect(await preflight.json()).not.toHaveProperty("readingId");
  await expect(
    page.getByRole("heading", { name: "This is a question about money and investments" }),
  ).toBeVisible();
  await expect(page.getByTestId("casino-wash-deck")).toHaveCount(0);

  const acknowledgedResponse = page.waitForResponse(
    (candidate) =>
      candidate.request().method() === "POST" &&
      new URL(candidate.url()).pathname === "/api/readings" &&
      candidate.status() === 201,
  );
  await page.getByRole("button", { name: "Continue as reflection", exact: true }).click();
  const acknowledged = await acknowledgedResponse;
  expect(acknowledged.status()).toBe(201);
  const acknowledgedBody = await acknowledged.json();
  expect(JSON.stringify(acknowledgedBody)).not.toMatch(/"cardId"|"assignments"/);

  const cardCount = acknowledgedBody.ceremony.spread.positions.length as number;
  await expect(
    page.getByRole("button", { name: "Choose face-down card 1", exact: true }),
  ).toBeEnabled({ timeout: 20_000 });
  const fan = page.getByTestId("casino-wash-deck");
  for (let index = 1; index <= cardCount; index += 1) {
    await page
      .getByRole("button", { name: `Choose face-down card ${index}`, exact: true })
      .press("Enter");
    // Wait for React to commit each keyboard selection before pressing the
    // next card; a busy WebKit runner can otherwise drop a pick.
    await expect(fan).toHaveAttribute("data-selected-count", String(index));
  }
  await page.getByRole("button", { name: "These are my cards" }).click();
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });
  await revealAllThroughUi(page);
  await expect(page.getByTestId("reading-journey")).toHaveAttribute("data-state", "complete", {
    timeout: 30_000,
  });
  await page.getByTestId("oracle-transcript").press("End");
  await page.getByTestId("complete-reading-action").click();
  await expect(
    page.getByText("This reading is a reflection to think with, not a statement of fact."),
  ).toBeVisible();
});
