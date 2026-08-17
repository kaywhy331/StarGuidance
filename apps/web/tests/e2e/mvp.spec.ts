import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

type ProfileKind = "date-only" | "all-fields" | "time-only";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`reader-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("synthetic-private-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(consent|onboarding)$/, { timeout: 20_000 });
  if (new URL(page.url()).pathname === "/consent") {
    await page.getByLabel(/I accept the current Terms/i).check();
    await page.getByLabel(/I have read the current Privacy Notice/i).check();
    await page.getByLabel(/I confirm that I am at least 18/i).check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
  }
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
}

async function createProfile(page: Page, kind: ProfileKind = "date-only") {
  await signIn(page);
  await page.getByLabel("Full birth name").fill("Ada Lovelace");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  if (kind === "all-fields")
    await page.getByLabel("Birth city / country").fill("London, United Kingdom");
  if (kind !== "date-only") await page.getByLabel("Birth time").fill("08:15");
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  await expect(page).toHaveURL(/\/readings$/, { timeout: 30_000 });
}

async function enterQuestionStep(page: Page) {
  const question = page.getByLabel("Your private question");
  if ((await question.count()) === 0) {
    await page.getByRole("button", { name: /^Continue with / }).click();
  }
  await expect(question).toBeVisible();
}

async function beginReading(page: Page, question = "What should I focus on next?") {
  await enterQuestionStep(page);
  await page.getByLabel("Your private question").fill(question);
  const readingResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/readings",
  );
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  expect((await readingResponse).status()).toBe(201);
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });
}

async function reachQuestionReflection(page: Page, reduceMotion = true) {
  if (reduceMotion) {
    const motionControl = page.getByRole("button", { name: /^Reduced motion/ });
    if ((await motionControl.getAttribute("aria-pressed")) !== "true") await motionControl.click();
  }
  await page
    .getByRole("button", { name: "Gather now", exact: true })
    .click({ timeout: 3_000 })
    .catch(() => {});
  await expect(page.getByTestId("question-reflection")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^(I’m ready|Continue revealing)$/ })).toBeVisible({
    timeout: 7_000,
  });
}

async function finishGuidedReveal(page: Page) {
  await page.getByRole("button", { name: /^(I’m ready|Continue revealing)$/ }).click();
  for (let index = 0; index < 10; index += 1) {
    const action = page.locator(".guided-next-action");
    await expect(action).toBeVisible({ timeout: 10_000 });
    const finalCard = (await action.textContent())?.includes("Continue to your reading") === true;
    await action.click();
    if (finalCard) return;
  }
  throw new Error("Guided reveal exceeded the supported ten-card spread.");
}

/** Drives the centered ritual through reflection and every deliberate card. */
async function finishRitual(page: Page) {
  await reachQuestionReflection(page);
  await finishGuidedReveal(page);
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.oracle-entry[data-phase="narration"] h2')).toBeVisible({
    timeout: 30_000,
  });
}

async function waitForReadingSections(page: Page, minimum = 9) {
  await expect
    .poll(
      async () =>
        Number(
          (await page.getByTestId("reading-journey").getAttribute("data-loaded-section-count")) ??
            0,
        ),
      { timeout: 45_000 },
    )
    .toBeGreaterThanOrEqual(minimum);
}

async function nextReadingSection(page: Page) {
  const next = page.getByRole("button", { name: "Next reading passage" });
  await expect(next).toBeEnabled();
  await next.click();
}

async function expectHorizontallyCentered(page: Page, selector: string) {
  await expect
    .poll(async () => {
      const bounds = await page.locator(selector).boundingBox();
      // `page.viewportSize().width` is the logical/outer viewport width and
      // does not shrink when a vertical scrollbar is present. The app's own
      // centering math (physical-tarot-card.tsx's `positionCard`) targets the
      // real rendered stage bounds instead, so a scrollbar appearing during
      // the ritual (e.g. from a fixed-position panel poking past 100dvh in a
      // given browser/env) narrows the actual content column without this
      // check's reference width moving to match — producing a false,
      // deterministic centering failure even though the UI is genuinely
      // centered in the space it actually has. Compare against
      // `document.documentElement.clientWidth`, which excludes the scrollbar
      // gutter, matching the frame of reference the app itself centers in.
      const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
      if (!bounds) return Number.POSITIVE_INFINITY;
      return Math.abs(bounds.x + bounds.width / 2 - clientWidth / 2);
    })
    .toBeLessThanOrEqual(3);
}

async function currentReading(page: Page) {
  const id = page.url().split("/").at(-1) as string;
  return page.evaluate(async (readingId) => {
    const response = await fetch(`/api/readings/${readingId}`, { cache: "no-store" });
    return (await response.json()) as {
      reading: {
        profileSnapshotId: string;
        draw: unknown;
        generationStatus: string;
        followUps: unknown[];
        questionClassification: {
          topic: string;
          horizon: string;
          intent: string;
          generalReading: boolean;
        };
        entitlementDecision: { outcome: string; mode: string };
        ritualProgress?: { cutTaken: boolean; revealedIndexes: number[]; phase: string };
      };
    };
  }, id);
}

test("reading selection and question entry stay focused, reversible steps", async ({ page }) => {
  await createProfile(page);
  await expect(
    page.getByRole("heading", { name: "What kind of space do you need?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Your private question")).toHaveCount(0);

  const relationshipSpread = page.locator('input[name="spread"][value="relationship"]');
  await relationshipSpread.locator("xpath=ancestor::label").click();
  await expect(relationshipSpread).toBeChecked();
  await page.getByRole("button", { name: "Continue with Relationship / Two-Party Spread" }).click();

  await expect(
    page.getByRole("heading", { name: "What would you like the cards to illuminate?" }),
  ).toBeVisible();
  await expect(page.getByLabel("Your private question")).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Reading type" })).toHaveCount(0);
  const chosenRitual = page.locator(".selected-ritual-summary");
  await expect(chosenRitual).toContainText("Relationship / Two-Party Spread");
  await chosenRitual.click();

  await expect(page.getByRole("radiogroup", { name: "Reading type" })).toBeVisible();
  await expect(relationshipSpread).toBeChecked();
});

test("date-only onboarding reaches a completed reading", async ({ page }) => {
  test.slow();
  await createProfile(page);
  const profile = await page.evaluate(async () => (await fetch("/api/profile")).json());
  expect(profile.profile.snapshot.completeness).toBe("core");
  await beginReading(page);
  await finishRitual(page);
  await waitForReadingSections(page);
  await expect(page.getByLabel("Keep the same cards and ask what they add")).toHaveCount(0);

  for (let index = 0; index < 3; index += 1) {
    await nextReadingSection(page);
    await expect(page.getByTestId("reading-result-overview")).toHaveCount(0);
    await expect(page.locator('.oracle-entry[data-phase="narration"]')).toBeVisible();
    await expect(page.getByTestId("oracle-transcript")).toHaveAttribute(
      "data-active-card-index",
      String(index),
    );
    await expect(page.locator(".physical-card-figure.is-reading-subject")).toHaveCount(1);
    await expect(page.locator(".oracle-entry-text")).toBeVisible();
  }

  for (let index = 0; index < 5; index += 1) await nextReadingSection(page);

  const transcript = page.getByTestId("oracle-transcript");
  await transcript.focus();
  await page.keyboard.press("Home");
  const overview = page.getByTestId("reading-result-overview");
  await expect(overview).toBeVisible();
  await expect(overview.getByRole("heading", { name: "Cards in this thread" })).toBeVisible();
  const lockedCards = overview.locator(".reading-card-strip button");
  await expect(lockedCards).toHaveCount(3);
  await expect(lockedCards.first().locator("small")).not.toBeEmpty();
  await expect(lockedCards.first().locator("strong")).not.toBeEmpty();
  await expect(lockedCards.first().locator("span")).toHaveText(/upright|reversed/);

  await expect(page.getByText("Explore the complete interpretation", { exact: true })).toHaveCount(
    0,
  );
  await page.keyboard.press("End");
  const integration = page.getByTestId("reading-integration");
  await expect(integration).toBeVisible();
  for (const reportHeading of [
    "Your agency",
    "Conditions to notice",
    "What could change the pattern",
  ])
    await expect(integration.getByRole("heading", { name: reportHeading })).toBeVisible();
  await expect(integration.locator(".reading-integration-question")).toContainText(
    "A question to carry",
  );
  await expect(integration.locator(".reading-uncertainty")).toBeVisible();
  await expect(page.getByLabel("Keep the same cards and ask what they add")).toBeVisible();

  const readingId = page.url().split("/").at(-1) as string;
  await page.goto("/history");
  await expect(page.getByText("Three-Card Spread")).toBeVisible();
  await page.locator(`a[href="/reading/${readingId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/reading/${readingId}$`));
  await expect(page.getByTestId("reading-result-scene")).toBeVisible();
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Skip cut", exact: true })).toHaveCount(0);
  await expect(page.locator('.oracle-entry[data-phase="narration"] h2')).toBeVisible();
});

test("all six selectable spreads use their configured spatial arrangements", async ({ page }) => {
  test.setTimeout(360_000);
  await createProfile(page);
  const cases = [
    {
      id: "one-card",
      kind: "centered",
      question: "Should I accept the invitation this week?",
      positions: [[0, 0, 0]],
      contextualNames: ["Yes / No Pivot"],
    },
    {
      id: "three-card",
      kind: "horizontal",
      question: "What is causing this project to stall?",
      positions: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
      ],
      contextualNames: ["The Problem", "The Cause", "The Resolution"],
    },
    {
      id: "celtic-cross",
      kind: "celtic-cross",
      question: "What should I understand about this complex transition?",
      positions: [
        [2, 1, 0],
        [2, 1, 90],
        [2, 0, 0],
        [2, 2, 0],
        [1, 1, 0],
        [3, 1, 0],
        [4, 3, 0],
        [4, 2, 0],
        [4, 1, 0],
        [4, 0, 0],
      ],
    },
    {
      id: "horseshoe",
      kind: "horseshoe",
      question: "What is shaping the next phase of this plan?",
      positions: [
        [0, 0, 0],
        [1, 1, 0],
        [2, 2, 0],
        [2, 3, 0],
        [2, 4, 0],
        [3, 1, 0],
        [4, 0, 0],
      ],
    },
    {
      id: "relationship",
      kind: "relationship",
      question: "What can I observe and choose in this relationship?",
      positions: [
        [0, 0, 0],
        [2, 0, 0],
        [0, 1, 0],
        [2, 1, 0],
        [1, 0, 0],
        [1, 1, 0],
        [1, 2, 0],
      ],
    },
    {
      id: "nine-card-matrix",
      kind: "matrix",
      question: "How is this situation developing across time and circumstance?",
      positions: [
        [0, 0, 0],
        [1, 0, 0],
        [2, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [2, 1, 0],
        [0, 2, 0],
        [1, 2, 0],
        [2, 2, 0],
      ],
    },
  ] as const;

  for (const spreadCase of cases) {
    const radio = page.locator(`input[name="spread"][value="${spreadCase.id}"]`);
    await radio.locator("xpath=ancestor::label").click();
    await expect(radio).toBeChecked();
    await enterQuestionStep(page);
    await page.getByLabel("Your private question").fill(spreadCase.question);
    await expect(page.getByRole("button", { name: "Begin the shuffle" })).toBeEnabled();
    const created = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/api/readings",
    );
    await page.getByRole("button", { name: "Begin the shuffle" }).click();
    expect((await created).status()).toBe(201);
    await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });
    await reachQuestionReflection(page);

    const stage = page.getByTestId("tarot-spread-stage");
    await expect(stage).toHaveAttribute("data-layout-kind", spreadCase.kind);
    const figures = stage.locator(".physical-card-figure");
    await expect(figures).toHaveCount(spreadCase.positions.length);
    const renderedPositions = await figures.evaluateAll((elements) =>
      elements.map((element) => [
        Number(element.getAttribute("data-spread-column")),
        Number(element.getAttribute("data-spread-row")),
        Number(element.getAttribute("data-spread-rotation")),
      ]),
    );
    expect(renderedPositions).toEqual(spreadCase.positions);

    if ("contextualNames" in spreadCase) {
      const readingId = page.url().split("/").at(-1)!;
      const names = await page.evaluate(async (id) => {
        const response = await fetch(`/api/readings/${id}`, { cache: "no-store" });
        const payload = (await response.json()) as {
          reading: { cards: { positionName: string }[] };
        };
        return payload.reading.cards.map(({ positionName }) => positionName);
      }, readingId);
      expect(names).toEqual(spreadCase.contextualNames);
    }

    await page.goto("/readings");
    await expect(page.locator(`input[name="spread"][value="${spreadCase.id}"]`)).toHaveCount(1);
  }
});

test("an authenticated session never loops back to the credential form", async ({ page }) => {
  await signIn(page);
  await page.goto("/sign-in?error=expired-link");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByLabel("Email")).toHaveCount(0);
});

test("a new user can create an account with email and password", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Email").fill(`new-reader-${randomUUID()}@example.test`);
  await page.getByLabel("Display name").fill("Nova");
  await page.getByLabel(/^Password/).fill("synthetic-private-password");
  await page.getByLabel("Confirm password").fill("synthetic-private-password");
  await page.getByLabel(/I agree to the versioned Terms/i).check();
  await page.getByLabel(/I have read the versioned Privacy Notice/i).check();
  await page.getByLabel(/I confirm that I am at least 18/i).check();
  await page.getByRole("button", { name: "Create private account" }).click();

  await expect(page).toHaveURL(/\/onboarding$/, { timeout: 20_000 });
});

test("password recovery does not reveal whether an email exists", async ({ page }) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(`unknown-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Email recovery instructions" }).click();

  await expect(page.getByText(/if an account exists/i)).toBeVisible();
});

test("the centered ritual mixes, gathers, deals, reflects, and reveals one card at a time", async ({
  page,
}) => {
  test.slow();
  await createProfile(page);
  const question = "What should I focus on next?";
  await beginReading(page, question);

  await expect(page.locator(".sanctuary-stage.is-shuffling")).toBeVisible();
  await expect(page.locator(".sanctuary-shuffle-shells span")).toHaveCount(15);
  const mixStyle = await page
    .locator(".sanctuary-shuffle-shells span")
    .first()
    .evaluate((element) => ({
      duration: getComputedStyle(element).animationDuration,
      scatterX: getComputedStyle(element).getPropertyValue("--scatter-x"),
      mixX: getComputedStyle(element).getPropertyValue("--mix-x"),
    }));
  expect(mixStyle.duration).toBe("5s");
  expect(mixStyle.scatterX).not.toBe(mixStyle.mixX);

  await page.getByRole("button", { name: "Gather now", exact: true }).click();
  const gathering = page.locator(".sanctuary-stage.is-gathering");
  await expect(gathering).toBeVisible();
  await expect(gathering.locator(".sanctuary-shuffle-shells span")).toHaveCount(15);
  expect(
    await gathering
      .locator(".sanctuary-shuffle-shells span")
      .first()
      .evaluate((element) => getComputedStyle(element).animationDuration),
  ).toBe("2s");
  await expect(page.getByRole("button", { name: "Cut", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Skip cut", exact: true })).toHaveCount(0);

  const deal = page.getByTestId("guided-deal");
  await expect(deal).toBeVisible({ timeout: 4_000 });
  const physicalCards = page.locator(".physical-card-figure");
  await expect(physicalCards).toHaveCount(1, { timeout: 2_000 });
  await expect(physicalCards).toHaveCount(2, { timeout: 1_500 });
  await expect(physicalCards).toHaveCount(3, { timeout: 1_500 });
  await expect(physicalCards.locator(".physical-tarot-card.is-revealed")).toHaveCount(0);
  await expect(page.getByTestId("oracle-transcript")).toHaveCount(0);

  const reflection = page.getByTestId("question-reflection");
  await expect(reflection).toBeVisible({ timeout: 3_000 });
  await expect(reflection).toContainText(question);
  await expectHorizontallyCentered(page, '[data-testid="question-reflection"]');
  await expect(page.getByRole("button", { name: "I’m ready", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "I’m ready", exact: true })).toBeVisible({
    timeout: 6_500,
  });

  await page.getByRole("button", { name: "I’m ready", exact: true }).click();
  const activeCard = page.locator(".physical-card-figure.is-cinematic-subject");
  const revealPanel = page.getByTestId("guided-reveal-panel");
  await expect(activeCard).toHaveClass(/is-cinematic-positioned/);
  await expect(revealPanel).toBeVisible();
  await expectHorizontallyCentered(page, ".physical-card-figure.is-cinematic-subject");
  await expect(revealPanel.locator(".guided-reveal-description")).not.toBeEmpty();
  await expect(revealPanel.locator(".guided-reveal-themes")).toContainText(/themes/i);
  await expect(physicalCards.locator(".physical-tarot-card.is-revealed")).toHaveCount(1);
  await expectHorizontallyCentered(page, '[data-testid="guided-reveal-panel"]');
  await expect
    .poll(async () => {
      const cardBounds = await activeCard.boundingBox();
      const panelBounds = await revealPanel.boundingBox();
      if (!cardBounds || !panelBounds) return Number.NEGATIVE_INFINITY;
      return panelBounds.y - (cardBounds.y + cardBounds.height);
    })
    .toBeGreaterThanOrEqual(0);

  const backgroundStyle = await page
    .locator(".physical-card-figure:not(.is-cinematic-subject)")
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { opacity: Number(style.opacity), filter: style.filter };
    });
  expect(backgroundStyle.opacity).toBeGreaterThanOrEqual(0.25);
  expect(backgroundStyle.filter).not.toContain("blur(2px)");
  await expect(page.locator(".physical-card-figure figcaption:not(.sr-only)")).toHaveCount(0);

  await page.getByRole("button", { name: /^Next card/ }).click();
  await expect(physicalCards.locator(".physical-tarot-card.is-revealed")).toHaveCount(2);
  await expect(page.getByTestId("tarot-spread-stage")).toHaveAttribute(
    "data-active-card-index",
    "1",
  );
  await page.getByRole("button", { name: /^Next card/ }).click();
  await expect(physicalCards.locator(".physical-tarot-card.is-revealed")).toHaveCount(3);
  await page.getByRole("button", { name: /^Continue to your reading/ }).click();

  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 30_000 });
});

test("all four birth details reach a completed reading", async ({ page }) => {
  await createProfile(page, "all-fields");
  const profile = await page.evaluate(async () => (await fetch("/api/profile")).json());
  expect(profile.profile.snapshot.completeness).toBe("complete");
  await beginReading(page, "How can I approach a new project?");
  await finishRitual(page);
});

test("birth time works without birthplace or timezone", async ({ page }) => {
  await createProfile(page, "time-only");
  const profile = await page.evaluate(async () => (await fetch("/api/profile")).json());
  expect(profile.profile.snapshot.completeness).toBe("core");
  expect(profile.profile.birthTimeProvided).toBe(true);
  await beginReading(page, "What can support my next decision?");
  await finishRitual(page);
});

test("omitted birth time never fabricates astrology or BaZi", async ({ page }) => {
  await createProfile(page);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Get full profile report" }).click();
  // Only the report tests reach the checkout route, so under `next dev` this
  // navigation always pays that route's first-request compilation cost.
  await expect(page).toHaveURL(/\/report\/[a-f0-9-]+$/, { timeout: 30_000 });
  await expect(page.getByText("Western astrology")).toBeVisible();
  await expect(page.getByText("BaZi Four Pillars")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Nine Star Ki", exact: true })).toBeVisible();
  await expect(page.getByText("Planetary angularity and location")).toBeVisible();
  await expect(page.getByText("Explicitly unavailable")).toHaveCount(3);
});

test("a reading stays pinned to the snapshot it was drawn against", async ({ page }) => {
  await createProfile(page, "all-fields");
  const before = await page.evaluate(
    async () =>
      (await fetch("/api/profile", { cache: "no-store" })).json() as Promise<{
        profile: {
          snapshot: { id: string; version: number; completeness: string };
          birthTimeProvided: boolean;
          birthplaceLabel?: string;
        };
      }>,
  );
  await beginReading(page);
  const reading = await currentReading(page);
  expect(reading.reading.profileSnapshotId, "a reading names the snapshot it interpreted").toBe(
    before.profile.snapshot.id,
  );

  // Updating birth data appends a new snapshot; the existing reading must keep
  // pointing at the version of the profile it actually interpreted.
  const sessionUrl = page.url();
  await page.goto("/onboarding");
  await expect(page.getByLabel("Full birth name")).toHaveValue("Ada Lovelace");
  await expect(page.getByLabel("Date of birth")).toHaveValue("1990-01-15");
  await expect(page.getByLabel("Birth time")).toHaveValue("08:15");
  await expect(page.getByLabel("Birth city / country")).toHaveValue("London, United Kingdom");
  await page.getByLabel("Birth city / country").fill("Edinburgh, United Kingdom");
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Save new profile snapshot" }).click();
  await expect(page).toHaveURL(/\/readings$/);

  const after = await page.evaluate(
    async () =>
      (await fetch("/api/profile", { cache: "no-store" })).json() as Promise<{
        profile: {
          snapshot: { id: string; version: number; completeness: string };
          birthTimeProvided: boolean;
          birthplaceLabel?: string;
        };
      }>,
  );
  expect(after.profile.snapshot.id).not.toBe(before.profile.snapshot.id);
  expect(after.profile.snapshot.version).toBeGreaterThan(before.profile.snapshot.version);
  expect(after.profile.snapshot.completeness).toBe("complete");
  expect(after.profile.birthTimeProvided).toBe(true);
  expect(after.profile.birthplaceLabel).toBe("Edinburgh, United Kingdom");

  await page.goto("/profile");
  await expect(page.getByText("Edinburgh, United Kingdom", { exact: true })).toBeVisible();
  await expect(page.getByText("Complete", { exact: true })).toBeVisible();

  await page.goto(sessionUrl);
  const unchanged = await currentReading(page);
  expect(
    unchanged.reading.profileSnapshotId,
    "the earlier reading still references the original snapshot",
  ).toBe(before.profile.snapshot.id);
});

test("AI-disabled mode returns the deterministic conversational fallback", async ({ page }) => {
  await createProfile(page);
  await beginReading(page);
  await finishRitual(page);
  await waitForReadingSections(page);
  for (let index = 0; index < 5; index += 1) await nextReadingSection(page);
  await expect(page.locator(".oracle-entry-text")).toContainText(
    /if the current energy continues/i,
  );
  await nextReadingSection(page);
  await expect(page.locator(".oracle-entry-text")).toContainText(/there is another route/i);
  await expect(page.getByRole("heading", { name: "Fated Path" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Divergent Path" })).toHaveCount(0);
  await page.getByTestId("oracle-transcript").focus();
  await page.keyboard.press("End");
  const integration = page.getByTestId("reading-integration");
  await expect(integration.getByRole("heading", { name: "Conditions to notice" })).toBeVisible();
  await expect(
    integration.getByRole("heading", { name: "What could change the pattern" }),
  ).toBeVisible();
  await expect(integration.locator(".reading-uncertainty")).toBeVisible();
  await expect(page.locator('.oracle-entry[data-phase="uncertainty"]')).toHaveCount(0);
});

test("an interrupted ritual recovers the identical locked draw", async ({ page }) => {
  await createProfile(page);
  await beginReading(page);
  const before = (await currentReading(page)).reading.draw;
  const cutProgress = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().postData()?.includes('"phase":"cuttingDeck"') === true,
  );
  await page.getByRole("button", { name: "Gather now", exact: true }).click();
  expect((await cutProgress).status()).toBe(200);
  const motionControl = page.getByRole("button", { name: /^Reduced motion/ });
  if ((await motionControl.getAttribute("aria-pressed")) !== "true") await motionControl.click();
  await expect(page.getByTestId("question-reflection")).toBeVisible({ timeout: 10_000 });
  const revealProgress = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.request().postData()?.includes('"phase":"revealingCards"') === true,
  );
  await page.getByRole("button", { name: "I’m ready", exact: true }).click();
  expect((await revealProgress).status()).toBe(200);
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(1);
  await expect(page.locator(".physical-card-caption")).toHaveCount(0);
  const durableProgress = (await currentReading(page)).reading.ritualProgress;
  expect(durableProgress).toMatchObject({
    cutTaken: false,
    revealedIndexes: [0],
    phase: "revealingCards",
  });
  await page.evaluate(() => window.sessionStorage.clear());
  // The recovered application marker below is the meaningful readiness
  // boundary. Firefox can commit the replacement document while a
  // non-critical resource keeps DOMContentLoaded pending indefinitely.
  await page.reload({ waitUntil: "commit" });
  await expect(page.getByTestId("tarot-spread-stage")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Skip cut", exact: true })).toHaveCount(0);
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(1);
  const after = (await currentReading(page)).reading.draw;
  expect(after).toEqual(before);
});

test("reading intake stores topic, horizon, intent, and entitlement apart from safety", async ({
  page,
}) => {
  await createProfile(page);
  await enterQuestionStep(page);
  await page.getByLabel("Topic").selectOption("career");
  await page.getByLabel("Time horizon").selectOption("months");
  await beginReading(page, "How should I prepare for a possible new role?");
  const intake = (await currentReading(page)).reading;
  expect(intake.questionClassification).toMatchObject({
    topic: "career",
    horizon: "months",
    intent: "decisionSupport",
    generalReading: false,
  });
  expect(intake.entitlementDecision).toMatchObject({ outcome: "granted", mode: "unlimited" });
});

test("the selected relationship topic remains authoritative in the generated result", async ({
  page,
}) => {
  await createProfile(page);
  await enterQuestionStep(page);
  await page.getByLabel("Topic").selectOption("relationships");
  await beginReading(page, "What should I understand about this new phase at work?");
  expect((await currentReading(page)).reading.questionClassification.topic).toBe("relationships");
  await finishRitual(page);
  const openingNarration = page.locator(".oracle-entry-text");
  await expect(openingNarration).toContainText("this connection");
  await expect(openingNarration).not.toContainText("structure around your work");
});

test("the approved general-reading path needs no custom question", async ({ page }) => {
  await createProfile(page);
  await enterQuestionStep(page);
  await page
    .getByLabel("Use a general reading when you do not want to ask a specific question.")
    .check();
  await expect(page.getByLabel("Your private question")).toHaveValue(
    "What would be most useful for me to notice and reflect on right now?",
  );
  const readingResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/readings",
  );
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  expect((await readingResponse).status()).toBe(201);
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });
  expect((await currentReading(page)).reading.questionClassification).toMatchObject({
    topic: "general",
    horizon: "open",
    intent: "generalReflection",
    generalReading: true,
  });
});

test("reduced-motion preference skips ritual transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await createProfile(page);
  await beginReading(page);
  await expect(page.getByRole("button", { name: "Reduced motion" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Reduced motion" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await finishRitual(page);
  await expect(page.locator(".oracle-cursor")).toHaveCount(0);
  await expect(page.getByTestId("mystic-sanctuary-scene")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  await waitForReadingSections(page);
  await nextReadingSection(page);
  await expectHorizontallyCentered(page, ".physical-card-figure.is-reading-subject");
});

test("a follow-up uses the exact same cards", async ({ page }) => {
  await createProfile(page);
  await beginReading(page, "What should I notice in this relationship?");
  await finishRitual(page);
  await waitForReadingSections(page);
  const journey = page.getByTestId("reading-journey");
  const primarySectionCount = Number(await journey.getAttribute("data-loaded-section-count"));
  const before = (await currentReading(page)).reading.draw;
  await expect(journey).toHaveAttribute("data-state", "complete");
  await page.getByTestId("oracle-transcript").focus();
  await page.keyboard.press("End");
  await expect(page.getByTestId("reading-integration")).toBeVisible();
  await page.getByLabel("Keep the same cards and ask what they add").fill("What can I do next?");
  await page.getByRole("button", { name: "Reflect on the same cards" }).click();
  await expect.poll(async () => (await currentReading(page)).reading.followUps.length).toBe(1);
  await expect(page.locator('.oracle-entry[data-phase="followUp"]')).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "The Cards Answer" })).toBeVisible();
  await expect(journey).toHaveAttribute(
    "data-loaded-section-count",
    String(primarySectionCount + 1),
  );
  await page.getByRole("button", { name: "Previous reading passage" }).click();
  await expect(page.getByRole("heading", { name: "Starlit Reflection" })).toHaveCount(0);
  await expect(page.locator(".oracle-entry-text")).toBeVisible();
  await page.getByRole("button", { name: "Next reading passage" }).click();
  await expect(page.getByRole("heading", { name: "The Cards Answer" })).toBeVisible();
  const after = (await currentReading(page)).reading.draw;
  expect(after).toEqual(before);
});

test("generation failure retries without a redraw", async ({ page }) => {
  test.setTimeout(150_000);
  await createProfile(page);
  const created = await page.evaluate(async () => {
    const response = await fetch("/api/readings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        "x-e2e-force-generation-failure": "1",
      },
      body: JSON.stringify({ spreadId: "three-card", question: "What should I consider?" }),
    });
    return (await response.json()) as { readingId: string; generationStatus: string };
  });
  expect(created.generationStatus).toBe("failed");
  await page.goto(`/session/${created.readingId}`);
  const before = (await currentReading(page)).reading.draw;
  await reachQuestionReflection(page);
  await finishGuidedReveal(page);
  await page.getByRole("button", { name: "Retry the same draw" }).click({ timeout: 20_000 });
  await expect(page.getByTestId("oracle-transcript")).toBeVisible();
  const after = (await currentReading(page)).reading.draw;
  expect(after).toEqual(before);
});

test("stream interruption preserves received paragraphs and retries the same draw", async ({
  page,
}) => {
  await createProfile(page);
  await beginReading(page, "What should I understand about this next step?");
  const before = (await currentReading(page)).reading.draw;
  // Arm the fault before the cards are revealed — reveal still blocks on the
  // user, which guarantees this lands well before the oracle
  // stream (which only starts once the ritual reaches "complete") can start.
  await page.evaluate(() => sessionStorage.setItem("sg:e2e-stream-fail-after", "2"));
  await reachQuestionReflection(page);
  await finishGuidedReveal(page);
  await expect(page.getByText(/Stream paused\. Your reading/i)).toBeVisible({
    timeout: 20_000,
  });
  const journey = page.getByTestId("reading-journey");
  const retained = Number((await journey.getAttribute("data-loaded-section-count")) ?? 0);
  expect(retained).toBeGreaterThanOrEqual(2);
  await page.getByRole("button", { name: "Retry reading" }).click();
  await expect
    .poll(async () => Number((await journey.getAttribute("data-loaded-section-count")) ?? 0))
    .toBeGreaterThan(retained);
  // The reading no longer carries a disclaimer; the standing statement lives in
  // the site terms, reachable from the footer of every page.
  await expect(page.locator('.oracle-entry[data-phase="uncertainty"]')).toHaveCount(0);
  expect((await currentReading(page)).reading.draw).toEqual(before);
});

test("long result text scrolls without clipping while buttons, keyboard, wheel, and touch navigate", async ({
  page,
}) => {
  await createProfile(page);
  await beginReading(page, "What patterns deserve my attention now?");
  await finishRitual(page);
  await waitForReadingSections(page);
  const journey = page.getByTestId("oracle-transcript");
  await expect(journey).toHaveCSS("overflow-y", "auto");

  await nextReadingSection(page);
  await expect(journey).toHaveAttribute("data-active-card-index", "0");

  await journey.focus();
  await page.keyboard.press("ArrowRight");
  await expect(journey).toHaveAttribute("data-active-card-index", "1");
  // Every word reserves its final layout position while opacity follows the
  // narration cadence, so scrolling remains stable during the fade itself.
  expect(await journey.locator(".oracle-word").count()).toBeGreaterThan(0);

  const bounds = await journey.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  const scrollMetrics = await journey.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(scrollMetrics.scrollHeight).toBeGreaterThanOrEqual(scrollMetrics.clientHeight);
  await journey.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(async () =>
      journey.evaluate(
        (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
      ),
    )
    .toBeLessThanOrEqual(1);
  await page.mouse.wheel(0, 500);
  await expect(journey).toHaveAttribute("data-active-card-index", "2");

  await journey.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const start = {
      clientX: bounds.left + bounds.width * 0.35,
      clientY: bounds.top + bounds.height / 2,
    };
    const end = {
      clientX: bounds.left + bounds.width * 0.75,
      clientY: bounds.top + bounds.height / 2,
    };
    const dispatchTouch = (
      type: "touchstart" | "touchend",
      touches: Array<typeof start>,
      changedTouches: Array<typeof start>,
    ) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        changedTouches: { value: changedTouches },
        targetTouches: { value: touches },
        touches: { value: touches },
      });
      element.dispatchEvent(event);
    };
    dispatchTouch("touchstart", [start], [start]);
    dispatchTouch("touchend", [], [end]);
  });
  await expect(journey).toHaveAttribute("data-active-card-index", "1");
});

test("keyboard users reveal and complete the guided reading before a same-draw follow-up", async ({
  page,
}) => {
  test.slow();
  await createProfile(page);
  await beginReading(page, "What should I practice in this conversation?");
  const before = (await currentReading(page)).reading.draw;

  // PRD UX-006: the centered ready and next-card controls remain fully
  // keyboard operable; the visual cards themselves are no longer arbitrary
  // competing reveal targets.
  await reachQuestionReflection(page);
  const ready = page.getByRole("button", { name: "I’m ready", exact: true });
  await ready.focus();
  await expect(ready).toBeFocused();
  await ready.press("Enter");
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(1);
  for (let index = 1; index < 3; index += 1) {
    const next = page.getByRole("button", { name: /^Next card/ });
    await next.focus();
    await expect(next).toBeFocused();
    await next.press("Enter");
    await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(index + 1);
  }
  const complete = page.getByRole("button", { name: /^Continue to your reading/ });
  await complete.focus();
  await expect(complete).toBeFocused();
  await complete.press("Enter");

  await waitForReadingSections(page);
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(3);
  const journey = page.getByTestId("oracle-transcript");
  await journey.focus();
  await page.keyboard.press("ArrowRight");
  await expect(journey).toHaveAttribute("data-active-card-index", "0");
  await page.keyboard.press("End");
  await expect(page.getByRole("heading", { name: "Starlit Reflection" })).toHaveCount(0);
  await expect(page.getByTestId("reading-integration")).toBeVisible();
  await expect(page.getByText("Explore the complete interpretation", { exact: true })).toHaveCount(
    0,
  );
  const composer = page.getByLabel("Keep the same cards and ask what they add");
  await expect(composer).toBeVisible();
  await composer.fill("What is one grounded action?");
  await composer.press("Enter");
  await expect.poll(async () => (await currentReading(page)).reading.followUps.length).toBe(1);
  expect((await currentReading(page)).reading.draw).toEqual(before);
});

test("physical card faces use specific illustrated assets without persistent captions", async ({
  page,
}) => {
  await createProfile(page);
  await beginReading(page);
  await reachQuestionReflection(page);
  const cards = page.locator(".physical-card-figure");
  await expect(cards).toHaveCount(3, { timeout: 10_000 });
  for (let index = 0; index < 3; index += 1) {
    await expect(cards.nth(index).locator(".physical-card-front img")).toHaveAttribute(
      "src",
      /\/art\/tarot\/v2\/.+\.svg$/,
    );
    // The card changes from a face-down to face-up static view around the same
    // moment the guided reveal advances, so a
    // measurement taken between two separate round trips can land on a
    // detached node mid-swap and read a permanent 0×0. Re-querying the live
    // DOM and polling inside a single evaluate call — no round trip for a
    // swap to land in the middle of — avoids racing it either way.
    const ratio = await page.evaluate(async (figureIndex) => {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const figure = document.querySelectorAll(".physical-card-figure")[figureIndex];
        const card = figure?.querySelector(".physical-tarot-card");
        const bounds = card?.getBoundingClientRect();
        if (bounds && bounds.width > 0) return bounds.height / bounds.width;
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return Number.NaN;
    }, index);
    expect(ratio).toBeGreaterThan(1.45);
    expect(ratio).toBeLessThan(1.55);
    const caption = cards.nth(index).locator("figcaption.sr-only");
    await expect(caption).toHaveCount(1);
    const captionStyle = await caption.evaluate((element) => {
      const style = getComputedStyle(element);
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height, overflow: style.overflow };
    });
    expect(captionStyle.width).toBeLessThanOrEqual(1);
    expect(captionStyle.height).toBeLessThanOrEqual(1);
    expect(captionStyle.overflow).toBe("hidden");
  }
});

test("mobile sanctuary assets stay within the atmospheric image budget", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "Representative mobile viewport only.");
  await createProfile(page);
  const background = page.locator(".sanctuary-background img");
  await expect
    .poll(
      () =>
        background.evaluate((image: HTMLImageElement) => (image.complete ? image.currentSrc : "")),
      { message: "the responsive mobile sanctuary asset finishes loading" },
    )
    .toContain("mobile");
  const assets = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry as PerformanceResourceTiming)
      .filter((entry) => entry.name.includes("/art/sanctuary/"))
      .map((entry) => ({ name: entry.name, transferSize: entry.transferSize })),
  );
  expect(assets.some(({ name }) => name.includes("mobile"))).toBe(true);
  expect(assets.reduce((total, asset) => total + asset.transferSize, 0)).toBeLessThan(350_000);
  await expect(page.locator("canvas")).toHaveCount(0);
});

test("Stripe test-mode report entitlement uses the credential-free local adapter", async ({
  page,
}) => {
  await createProfile(page);
  await page.goto("/profile");
  await expect(page.getByText("Cross-system contradictions")).toBeVisible();
  await page.getByRole("button", { name: "Get full profile report" }).click();
  await expect(page).toHaveURL(/\/report\/[a-f0-9-]+$/, { timeout: 30_000 });
  await expect(page.getByText(/Life Path \d+; Expression \d+/)).toBeVisible();
  await expect(page.getByText(/local test adapter/i)).toBeVisible();
  const reportId = page.url().split("/").at(-1)!;
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download accessible PDF" }).click();
  expect((await download).suggestedFilename()).toBe(
    `starguidance-profile-report-${reportId.slice(0, 8)}.pdf`,
  );
  await page.goto("/reports");
  await expect(page.getByRole("heading", { name: "Profile reports" })).toBeVisible();
  await expect(page.locator(`a[href="/report/${reportId}"]`)).toBeVisible();
});

test("the standing terms are reachable from every page instead of every reading", async ({
  page,
}) => {
  await page.goto("/sign-in");
  const terms = page.getByRole("link", { name: /Terms & how to read a reading/i });
  await expect(terms).toBeVisible();
  await terms.click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(/Terms/i);
  await expect(page.getByText(/not a factual prediction/i)).toBeVisible();
  await expect(page.getByText(/crisis/i).first()).toBeVisible();
});
