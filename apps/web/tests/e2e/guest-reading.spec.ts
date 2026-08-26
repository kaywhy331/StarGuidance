import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

test("a visitor completes a causal free reading before signup and continues with the exact cards", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  const freeReading = page.getByRole("link", { name: "Free Reading" });
  await expect(freeReading).toHaveAttribute("href", "/free-reading");
  await freeReading.click();

  await expect(
    page.getByRole("heading", { name: "What would you like the cards to illuminate?" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Reduce motion" }).click();
  await page.getByLabel("Your birthday").fill("1990-01-15");
  await page.getByLabel(/I agree to the Terms/i).check();
  await page.getByLabel(/I have read the Privacy Notice/i).check();
  await page.getByLabel(/I confirm that I am at least 18/i).check();
  await page
    .getByLabel("Your private guest question")
    .fill("What can I understand about the next step in my work?");
  await page.getByRole("button", { name: "Review my question" }).click();
  await expect(page.getByTestId("guest-question-confirmation")).toContainText(
    "What can I understand about the next step in my work?",
  );
  await page.getByRole("button", { name: "Confirm this question" }).click();

  const spreadOptions = page.getByRole("radiogroup", { name: "Free reading type" });
  await expect(spreadOptions).toBeVisible();
  await expect
    .poll(
      async () => {
        const spreadBox = await spreadOptions.boundingBox();
        const viewport = page.viewportSize();
        if (!spreadBox || !viewport) return Number.POSITIVE_INFINITY;
        return Math.abs(spreadBox.x + spreadBox.width / 2 - viewport.width / 2);
      },
      {
        message: "the spread selector settles on the horizontal viewport center",
        timeout: 5_000,
      },
    )
    .toBeLessThanOrEqual(3);
  await expect(page.getByTestId("guest-spread-position-preview")).toContainText("Situation");
  await expect(page.getByTestId("guest-spread-position-preview")).toContainText("Challenge");
  await expect(page.getByTestId("guest-spread-position-preview")).toContainText("Direction");

  const prepared = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/guest-readings" &&
      response.request().postData()?.includes('"action":"prepare"') === true,
  );
  await page
    .getByRole("button", { name: "Confirm Three Cards — Situation, Challenge, Direction" })
    .click();
  const preparedResponse = await prepared;
  expect(preparedResponse.status()).toBe(201);
  expect(JSON.stringify(await preparedResponse.json())).not.toMatch(
    /"cardId"|"assignments"|"orientation"/,
  );

  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  await expect(page.getByTestId("guest-reading-experience")).toHaveAttribute(
    "data-ritual-phase",
    "shuffling",
  );
  await expect(page.locator(".full-deck-possibility-field i")).toHaveCount(78);
  const nonceBeforeStir = await page.evaluate(() => {
    const pending = JSON.parse(sessionStorage.getItem("sg:guest-reading:v2") ?? "{}") as {
      clientNonce?: string;
    };
    return pending.clientNonce;
  });
  await page.getByRole("button", { name: "Stir all 78 cards" }).click();
  const entropyAfterStir = await page.evaluate(() => {
    return JSON.parse(sessionStorage.getItem("sg:guest-reading:v2") ?? "{}") as {
      clientNonce?: string;
      stirCount?: number;
    };
  });
  expect(nonceBeforeStir).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(entropyAfterStir.clientNonce).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(entropyAfterStir.clientNonce).not.toBe(nonceBeforeStir);
  expect(entropyAfterStir.stirCount).toBe(1);
  await page.getByRole("button", { name: "Finish shuffling" }).click();
  const finalized = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/guest-readings" &&
      response.request().postData()?.includes('"action":"finalize"') === true,
  );
  await page.getByRole("button", { name: "Continue without a cut" }).click();
  const finalizedResponse = await finalized;
  expect(finalizedResponse.status()).toBe(201);
  const finalizedBody = (await finalizedResponse.json()) as {
    reading: {
      cards: { cardId: string; orientation: "upright" | "reversed" }[];
      result?: unknown;
    };
  };
  expect(finalizedBody.reading.cards).toHaveLength(3);
  expect(finalizedBody.reading.result).toBeUndefined();
  const originalCards = finalizedBody.reading.cards.map(({ cardId }) => cardId);

  await expect(page.getByTestId("guest-question-reflection")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".physical-card-front")).toHaveCount(0);
  await expect(page.getByTestId("oracle-transcript")).toHaveCount(0);
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Reveal card 3, face down" }).click();
  await expect(page.getByTestId("guest-guided-reveal-panel")).toContainText("Direction");
  await expect(page.getByTestId("oracle-transcript")).toHaveCount(0);
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveAttribute(
    "data-card-id",
    originalCards[2]!,
  );
  await page.getByRole("button", { name: /Return to the spread/ }).click();
  await page.getByRole("button", { name: "Reveal All" }).click();

  const activePassage = page.getByTestId("reading-active-passage");
  const signupGate = page.getByTestId("guest-signup-gate");
  await expect(activePassage).toBeVisible({ timeout: 20_000 });
  await expect(activePassage.locator(".oracle-entry-text")).toHaveText(/\S/);
  await expect(activePassage.locator(".oracle-entry-text")).toContainText(
    "the next step in your work",
  );
  await expect(activePassage).not.toContainText("whose function is");
  await expect(activePassage).not.toContainText("current pattern begins with");
  await expect(page.getByTestId("tarot-spread-stage")).toBeVisible();
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(3);
  await expect(signupGate).toHaveCount(0);
  await expect(page.getByTestId("guest-reading-experience")).toHaveAttribute(
    "data-reading-focus",
    "reading",
  );
  await page.getByTestId("oracle-transcript").press("End");
  await page.getByTestId("complete-reading-action").click();
  await expect(activePassage).toHaveCount(0);
  await expect(signupGate).toBeVisible();
  await expect(page.getByTestId("guest-reading-experience")).toHaveAttribute(
    "data-reading-focus",
    "actions",
  );

  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.removeItem("sg:guest-trial-used:v1");
  });
  await page.goto("/free-reading");
  await expect(page.getByRole("region", { name: "Your locked tarot spread" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.locator(".physical-card-front")).toHaveCount(0);
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Reveal card 3, face down" }).click();
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveAttribute(
    "data-card-id",
    originalCards[2]!,
  );
  await page.getByRole("button", { name: /Return to the spread/ }).click();
  await page.getByRole("button", { name: "Reveal All" }).click();
  await expect(page.getByTestId("reading-active-passage")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("guest-signup-gate")).toHaveCount(0);
  await page.getByTestId("oracle-transcript").press("End");
  await page.getByTestId("complete-reading-action").click();
  await expect(page.getByTestId("guest-signup-gate")).toBeVisible();
  await page.getByRole("link", { name: "Sign up to continue" }).click();
  await expect(page).toHaveURL(/\/sign-up\?next=/);

  await page.getByLabel("Email").fill(`guest-${randomUUID()}@example.test`);
  await page.getByLabel("Display name").fill("Nova");
  await page.getByLabel(/^Password/).fill("synthetic-private-password");
  await page.getByLabel("Confirm password").fill("synthetic-private-password");
  await page.getByRole("button", { name: "Continue to privacy commitments" }).click();
  await page.getByLabel(/I agree to the versioned Terms/i).check();
  await page.getByLabel(/I have read the versioned Privacy Notice/i).check();
  await page.getByLabel(/I confirm that I am at least 18/i).check();
  await page.getByRole("button", { name: "Create private account" }).click();

  await expect(page).toHaveURL(/\/free-reading\?continue=1$/, { timeout: 20_000 });
  await expect(page.getByText("Same cards · account unlocked")).toBeVisible({ timeout: 20_000 });
  const recoveredCards = await page
    .locator(".guest-locked-spread-review li")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-card-id")));
  expect(recoveredCards).toEqual(originalCards);

  await page
    .getByLabel("Ask these same cards one follow-up")
    .fill("What is one practical way to meet that same next step?");
  await page.getByRole("button", { name: "Ask the same cards" }).click();
  await expect(
    page.getByRole("heading", { name: "A clarification from the original spread" }),
  ).toBeVisible();
  await expect(page.getByText(/did not alter the cards/i)).toBeVisible();
});
