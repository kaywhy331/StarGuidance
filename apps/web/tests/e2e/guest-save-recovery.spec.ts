import { randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";

type SavedReading = {
  reading: {
    source?: string;
    profileSnapshotId: string | null;
    draw: { assignments: { cardId: string; orientation: string }[] };
    followUps: unknown[];
  };
};

/**
 * Reaches a control with the real Tab / Shift+Tab keys only. The browser
 * resumes sequential navigation from wherever focus last was (after the
 * follow-up renders that is below the control, and Firefox does not wrap
 * within the page), so the search runs forward to the end of the tab order
 * and then backward, stopping when a key press no longer moves focus. A
 * control missing from the tab order still fails, listing what was visited.
 */
async function tabTo(page: Page, target: Locator) {
  const focused = () =>
    page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return "";
      const label = (active.getAttribute("aria-label") ?? active.textContent ?? "").trim();
      return `${[...document.querySelectorAll("*")].indexOf(active)}:${active.tagName}:${label.slice(0, 30)}`;
    });
  const visited: string[] = [];
  for (const key of ["Tab", "Shift+Tab"]) {
    let previous = await focused();
    for (let step = 0; step < 80; step += 1) {
      await page.keyboard.press(key);
      if (await target.evaluate((element) => element === document.activeElement)) return;
      const current = await focused();
      if (current === previous) break;
      visited.push(current);
      previous = current;
    }
  }
  throw new Error(
    `The control was not reachable with the keyboard. Visited: ${visited.join(" | ")}`,
  );
}

/** Draws a synthetic guest reading and signs up, ending on the signed-in
 * continuation with the exact original cards recovered and nothing saved. */
async function drawAsGuestAndSignUp(page: Page): Promise<string[]> {
  await page.goto("/free-reading");
  await expect(page.getByLabel("Your birthday")).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("Your birthday").fill("1990-01-15");
  await page
    .getByLabel(/I’m 18 or older, I agree to the Terms/i)
    .evaluate((checkbox: HTMLInputElement) => checkbox.click());
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "What would you like to ask the cards?" }),
  ).toBeVisible();
  const prepared = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/guest-readings" &&
      response.request().postData()?.includes('"action":"prepare"') === true,
  );
  await page
    .getByLabel("What would you like to ask the cards?")
    .fill("What can I understand about the next step in my work?");
  await page.getByRole("button", { name: "Draw my cards" }).click();
  const preparedBody = await (await prepared).json();
  await expect(page.locator(".casino-card-shell")).toHaveCount(78);
  await page.getByRole("button", { name: "Keep shuffling" }).click();
  await page.getByRole("button", { name: "Motion: Full" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  const finalized = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/guest-readings" &&
      response.request().postData()?.includes('"action":"finalize"') === true,
  );
  const cardCount = preparedBody.ceremony.spread.positions.length as number;
  await expect(
    page.getByRole("button", { name: "Choose face-down card 1", exact: true }),
  ).toBeEnabled({ timeout: 20_000 });
  const fanSurface = page.getByTestId("casino-fan-hit-surface");
  const fanBounds = await fanSurface.boundingBox();
  if (!fanBounds) throw new Error("The casino fan selection surface is not visible.");
  for (let index = 0; index < cardCount; index += 1)
    await fanSurface.click({
      position: { x: fanBounds.width * ((index + 1) / (cardCount + 1)), y: fanBounds.height / 2 },
    });
  await page.getByTestId("confirm-selected-cards").click();
  const finalizedBody = (await (await finalized).json()) as {
    reading: { cards: { cardId: string; orientation: string }[] };
  };
  const drawn = finalizedBody.reading.cards.map(
    ({ cardId, orientation }) => `${cardId}:${orientation}`,
  );

  await expect(page.getByTestId("guest-question-reflection")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Turn over all cards" }).click();
  await expect(page.getByTestId("reading-active-passage")).toBeVisible({ timeout: 20_000 });
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
  await page.getByLabel(/I agree to the Terms/i).check();
  await page.getByLabel(/I have read the Privacy Notice/i).check();
  await page.getByLabel(/I confirm that I am at least 18/i).check();
  await page.getByRole("button", { name: "Create private account" }).click();
  await expect(page).toHaveURL(/\/free-reading\?continue=1$/, { timeout: 20_000 });
  await expect(page.getByText("Same cards, now in your account")).toBeVisible({
    timeout: 20_000,
  });
  const recovered = await page
    .getByTestId("guest-continuation-keepsake")
    .getAttribute("data-card-assignments");
  expect(recovered?.split(" ")).toEqual(drawn);
  return drawn;
}

test("a lost save reply, a later follow-up, and keyboard retries leave one saved reading with its follow-up", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const drawn = await drawAsGuestAndSignUp(page);

  const saveBodies: string[] = [];
  let dropNextSaveReply = true;
  await page.route("**/api/guest-readings/continue", async (route) => {
    const body = route.request().postData() ?? "";
    if (!body.includes('"action":"save"')) return route.fallback();
    saveBodies.push(body);
    if (!dropNextSaveReply) return route.fallback();
    dropNextSaveReply = false;
    // The server stores the reading, but the reader never hears back.
    await route.fetch();
    return route.abort("failed");
  });
  const history = async () =>
    ((await (await page.request.get("/api/readings")).json()) as { readings: { id: string }[] })
      .readings;
  const savedReading = async (id: string) =>
    (await (await page.request.get(`/api/readings/${id}`)).json()) as SavedReading;

  // Consent: nothing is saved by arriving, recovering, or asking a follow-up.
  const savePanel = page.getByTestId("guest-save-panel");
  const saveButton = savePanel.getByRole("button", { name: "Save to my readings" });
  expect(saveBodies).toHaveLength(0);
  expect(await history()).toEqual([]);

  // Keyboard: Tab to Save and press Enter. The reply is lost.
  await tabTo(page, saveButton);
  await page.keyboard.press("Enter");
  await expect.poll(() => saveBodies.length).toBe(1);
  await expect(saveButton).toBeEnabled();
  await expect(savePanel.getByRole("status")).toHaveCount(0);
  const [stranded] = await history();
  expect(stranded).toBeDefined();
  const strandedId = stranded!.id;
  expect((await savedReading(strandedId)).reading.followUps).toHaveLength(0);

  // Still unsaved from the reader's view: ask the same cards a follow-up by keyboard.
  const followUpField = page.getByLabel("Ask these same cards one follow-up");
  await followUpField.fill("What is one practical way to meet that same next step?");
  await tabTo(page, page.getByRole("button", { name: "Ask the same cards" }));
  await page.keyboard.press("Enter");
  await expect(
    page.getByTestId("reading-keepsake").getByRole("heading", { name: /Follow-up on these cards/ }),
  ).toBeVisible();
  // Asking never saves on its own.
  expect(saveBodies).toHaveLength(1);
  expect((await savedReading(strandedId)).reading.followUps).toHaveLength(0);

  // Explicit retry from the keyboard (Space this time).
  await tabTo(page, saveButton);
  await page.keyboard.press("Space");
  await expect(savePanel.getByRole("status")).toContainText("Saved to your readings", {
    timeout: 20_000,
  });
  expect(saveBodies).toHaveLength(2);
  expect(JSON.parse(saveBodies[1]!)).toMatchObject({ action: "save" });
  expect(JSON.parse(saveBodies[1]!).followUpQuestion).toBeTruthy();

  // Repeated retries (same receipt and follow-up) stay idempotent.
  for (let repeat = 0; repeat < 2; repeat += 1) {
    const again = await page.request.post("/api/guest-readings/continue", {
      data: JSON.parse(saveBodies[1]!),
      headers: { origin: new URL(page.url()).origin },
    });
    expect(again.status()).toBe(200);
    expect(await again.json()).toMatchObject({ readingId: strandedId, alreadySaved: true });
  }
  expect(await history()).toEqual([expect.objectContaining({ id: strandedId })]);
  const stored = await savedReading(strandedId);
  expect(stored.reading).toMatchObject({ source: "guest_trial", profileSnapshotId: null });
  expect(stored.reading.draw.assignments.map((a) => `${a.cardId}:${a.orientation}`)).toEqual(drawn);
  expect(stored.reading.followUps).toHaveLength(1);

  // Interrupted page: reloading recovers the same saved entry, not a second one.
  await page.reload();
  await expect(page.getByTestId("guest-save-panel").getByRole("status")).toContainText(
    "Saved to your readings",
    { timeout: 20_000 },
  );
  await expect(page.getByRole("button", { name: "Save to my readings" })).toHaveCount(0);

  // Keyboard into the saved reading and history.
  const open = page.getByTestId("guest-save-panel").getByRole("link", {
    name: "Open it in my readings",
  });
  await tabTo(page, open);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/reading/${strandedId}$`), { timeout: 20_000 });
  await expect(
    page.getByTestId("reading-keepsake").getByRole("heading", { name: /Follow-up on these cards/ }),
  ).toBeVisible({ timeout: 20_000 });
  await page.goto("/history");
  await expect(page.getByText(/Your free reading/)).toHaveCount(1, { timeout: 20_000 });
  expect(saveBodies).toHaveLength(2);
});
