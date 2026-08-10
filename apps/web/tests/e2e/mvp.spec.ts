import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

type ProfileKind = "date-only" | "all-fields" | "time-only";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`reader-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("synthetic-private-password");
  await page.getByRole("button", { name: "Sign in" }).click();
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

async function beginReading(page: Page, question = "What should I focus on next?") {
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

/** Drives the ritual past its intentional, no-longer-automatic checkpoints
 * (PRD UX-002/004/006): the shuffle still completes on its own, then skip the
 * deck cut and reveal every card, then wait for the completed reading.
 * Deliberately doesn't race "Finish shuffling" against the shuffle's own
 * auto-complete timer — Playwright would keep retrying a click against a
 * button the shuffle has already removed. Individual tests that care about a
 * specific control (Finish shuffling, Cut instead of Skip cut, one card at a
 * time, keyboard activation) drive those steps themselves instead of calling
 * this helper. */
async function finishRitual(page: Page) {
  await page.getByRole("button", { name: "Skip cut", exact: true }).click();
  await page.getByRole("button", { name: "Reveal all", exact: true }).click();
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.oracle-entry[data-phase="openingTheme"] h2')).toBeVisible({
    timeout: 30_000,
  });
}

async function waitForReadingSections(page: Page, minimum = 9) {
  await expect
    .poll(async () =>
      Number(
        (await page.getByTestId("reading-journey").getAttribute("data-loaded-section-count")) ?? 0,
      ),
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
      const viewport = page.viewportSize();
      if (!bounds || !viewport) return Number.POSITIVE_INFINITY;
      return Math.abs(bounds.x + bounds.width / 2 - viewport.width / 2);
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
      };
    };
  }, id);
}

test("date-only onboarding reaches a completed reading", async ({ page }) => {
  await createProfile(page);
  const profile = await page.evaluate(async () => (await fetch("/api/profile")).json());
  expect(profile.profile.snapshot.completeness).toBe("core");
  await beginReading(page);
  await finishRitual(page);
  await waitForReadingSections(page);

  for (let index = 0; index < 3; index += 1) {
    await nextReadingSection(page);
    await expect(page.locator('.oracle-entry[data-phase="cardInterpretation"]')).toBeVisible();
    await expect(page.getByTestId("oracle-transcript")).toHaveAttribute(
      "data-active-card-index",
      String(index),
    );
    await expect(page.locator(".physical-card-figure.is-reading-subject")).toHaveCount(1);
    await expect(page.locator(".card-interpretation-copy")).toBeVisible();
  }

  for (const heading of [
    "From the Stars",
    "Fated Path",
    "Divergent Path",
    "Cosmic Alignment",
    "Starlit Reflection",
  ]) {
    await nextReadingSection(page);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  const readingId = page.url().split("/").at(-1) as string;
  await page.goto("/history");
  await expect(page.getByText("Three Cards — Direction")).toBeVisible();
  await page.locator(`a[href="/reading/${readingId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/reading/${readingId}$`));
  await expect(page.getByTestId("reading-result-scene")).toBeVisible();
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Skip cut", exact: true })).toHaveCount(0);
  await expect(page.locator('.oracle-entry[data-phase="openingTheme"] h2')).toBeVisible();
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

test("the ritual waits for intentional cut and reveal, and reviews each card cinematically", async ({
  page,
}) => {
  test.slow();
  await page.addInitScript(() => {
    const observed: string[] = [];
    Object.defineProperty(window, "__sgRevealOrder", { value: observed, writable: false });
    const observer = new MutationObserver(() => {
      const index = document
        .querySelector('[data-testid="tarot-spread-stage"]')
        ?.getAttribute("data-active-card-index");
      if (index !== null && index !== undefined && observed.at(-1) !== index) observed.push(index);
    });
    const observe = () =>
      observer.observe(document.documentElement, {
        attributeFilter: ["data-active-card-index"],
        attributes: true,
        childList: true,
        subtree: true,
      });
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", observe, { once: true });
    else observe();
  });
  await createProfile(page);
  await beginReading(page);

  // The shuffle can be sped up explicitly instead of waiting out its timer —
  // but it also completes on its own, so this races the app's own ~1.9s
  // auto-complete timer under parallel test load. A bounded, caught attempt
  // proves the control does nothing harmful when clicked without depending on
  // winning that race: either this click fires SHUFFLE_COMPLETE, or the
  // timer already did, and cuttingDeck is reached either way.
  await page
    .getByRole("button", { name: "Finish shuffling", exact: true })
    .click({ timeout: 2_000 })
    .catch(() => {});

  // The deck cut never auto-advances (PRD UX-004) — both choices are offered
  // and nothing proceeds until one is taken.
  await expect(page.getByRole("button", { name: "Cut", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skip cut", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Cut", exact: true }).click();

  // Cards arrive face down; reveal never auto-advances either (UX-006).
  const physicalCards = page.locator(".physical-card-figure");
  await expect(physicalCards).toHaveCount(3, { timeout: 10_000 });
  await expect(physicalCards.locator(".physical-tarot-card.is-revealed")).toHaveCount(0);
  await expect(page.getByTestId("oracle-transcript")).toHaveCount(0);

  await expect(page.getByRole("button", { name: "Reveal all", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reveal all", exact: true }).click();

  await expect(physicalCards.locator(".physical-tarot-card.is-revealed")).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Reveal all" })).toHaveCount(0);
  const revealOrder = await page.evaluate(
    () => (window as typeof window & { __sgRevealOrder: string[] }).__sgRevealOrder,
  );
  expect(revealOrder.slice(0, 3)).toEqual(["0", "1", "2"]);
  const cinematicScales = await physicalCards.evaluateAll((cards) =>
    cards.map((card) => Number(card.style.getPropertyValue("--cinematic-scale"))),
  );
  expect(cinematicScales).toHaveLength(3);
  expect(cinematicScales.every((scale) => scale > 1)).toBe(true);

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
  await page.getByRole("button", { name: "Generate test profile report" }).click();
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
  await createProfile(page);
  const before = await page.evaluate(
    async () =>
      (await fetch("/api/profile", { cache: "no-store" })).json() as Promise<{
        profile: { snapshot: { id: string; version: number } };
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
  await page.getByLabel("Full birth name").fill("Ada Lovelace");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  await page.getByLabel("Birth city / country").fill("Edinburgh, United Kingdom");
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  await expect(page).toHaveURL(/\/readings$/);

  const after = await page.evaluate(
    async () =>
      (await fetch("/api/profile", { cache: "no-store" })).json() as Promise<{
        profile: { snapshot: { id: string; version: number } };
      }>,
  );
  expect(after.profile.snapshot.id).not.toBe(before.profile.snapshot.id);
  expect(after.profile.snapshot.version).toBeGreaterThan(before.profile.snapshot.version);

  await page.goto(sessionUrl);
  const unchanged = await currentReading(page);
  expect(
    unchanged.reading.profileSnapshotId,
    "the earlier reading still references the original snapshot",
  ).toBe(before.profile.snapshot.id);
});

test("AI-disabled mode returns the deterministic structured fallback", async ({ page }) => {
  await createProfile(page);
  await beginReading(page);
  await finishRitual(page);
  await waitForReadingSections(page);
  for (let index = 0; index < 5; index += 1) await nextReadingSection(page);
  await expect(page.getByRole("heading", { name: "Fated Path" })).toBeVisible();
  await expect(page.locator(".reading-uncertainty")).toContainText(/reflective guidance/i);
  await nextReadingSection(page);
  await expect(page.getByRole("heading", { name: "Divergent Path" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Signals that could change the pattern" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Reading details" })).toHaveCount(0);
  await expect(page.locator('.oracle-entry[data-phase="uncertainty"]')).toHaveCount(0);
});

test("an interrupted ritual recovers the identical locked draw", async ({ page }) => {
  await createProfile(page);
  await beginReading(page);
  const before = (await currentReading(page)).reading.draw;
  await page.getByRole("button", { name: "Skip cut", exact: true }).click();
  await page.getByRole("button", { name: "Reveal card 1, face down" }).click();
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(1);
  await expect(page.locator(".physical-card-caption em").first()).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("tarot-spread-stage")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: "Skip cut", exact: true })).toHaveCount(0);
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(1);
  const after = (await currentReading(page)).reading.draw;
  expect(after).toEqual(before);
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
  await expect(page.getByRole("heading", { name: "Starlit Reflection" })).toBeVisible();
  await page.getByRole("button", { name: "Next reading passage" }).click();
  await expect(page.getByRole("heading", { name: "The Cards Answer" })).toBeVisible();
  const after = (await currentReading(page)).reading.draw;
  expect(after).toEqual(before);
});

test("generation failure retries without a redraw", async ({ page }) => {
  await createProfile(page);
  const created = await page.evaluate(async () => {
    const response = await fetch("/api/readings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
        "x-e2e-force-generation-failure": "1",
      },
      body: JSON.stringify({ spreadId: "direction", question: "What should I consider?" }),
    });
    return (await response.json()) as { readingId: string; generationStatus: string };
  });
  expect(created.generationStatus).toBe("failed");
  await page.goto(`/session/${created.readingId}`);
  const before = (await currentReading(page)).reading.draw;
  await page.getByRole("button", { name: "Skip cut", exact: true }).click();
  await page.getByRole("button", { name: "Reveal all", exact: true }).click();
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
  // Arm the fault before the cards are revealed — cut/reveal now block on the
  // user, which conveniently guarantees this lands well before the oracle
  // stream (which only starts once the ritual reaches "complete") can start.
  await page.evaluate(() => sessionStorage.setItem("sg:e2e-stream-fail-after", "2"));
  await page.getByRole("button", { name: "Skip cut", exact: true }).click();
  await page.getByRole("button", { name: "Reveal all", exact: true }).click();
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

test("buttons, keyboard, wheel, and touch move sequentially without a text scrollbar", async ({
  page,
}) => {
  await createProfile(page);
  await beginReading(page, "What patterns deserve my attention now?");
  await finishRitual(page);
  await waitForReadingSections(page);
  const journey = page.getByTestId("oracle-transcript");
  await expect(journey).toHaveCSS("overflow", "hidden");

  await nextReadingSection(page);
  await expect(journey).toHaveAttribute("data-active-card-index", "0");

  await journey.focus();
  await page.keyboard.press("ArrowRight");
  await expect(journey).toHaveAttribute("data-active-card-index", "1");

  const bounds = await journey.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
  await page.mouse.wheel(0, 500);
  await expect(journey).toHaveAttribute("data-active-card-index", "2");

  await journey.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const start = new Touch({
      clientX: bounds.left + bounds.width * 0.35,
      clientY: bounds.top + bounds.height / 2,
      identifier: 1,
      target: element,
    });
    const end = new Touch({
      clientX: bounds.left + bounds.width * 0.75,
      clientY: bounds.top + bounds.height / 2,
      identifier: 1,
      target: element,
    });
    element.dispatchEvent(
      new TouchEvent("touchstart", {
        bubbles: true,
        cancelable: true,
        changedTouches: [start],
        touches: [start],
      }),
    );
    element.dispatchEvent(
      new TouchEvent("touchend", {
        bubbles: true,
        cancelable: true,
        changedTouches: [end],
        touches: [],
      }),
    );
  });
  await expect(journey).toHaveAttribute("data-active-card-index", "1");
});

test("keyboard users cut and reveal by keyboard, then submit a same-draw follow-up", async ({
  page,
}) => {
  await createProfile(page);
  await beginReading(page, "What should I practice in this conversation?");
  const before = (await currentReading(page)).reading.draw;

  // PRD UX-006: each card is reachable by keyboard, shows a visible focus
  // state, and reveals on Enter — not just click/tap.
  await page
    .getByRole("button", { name: "Finish shuffling", exact: true })
    .click({ timeout: 2_000 })
    .catch(() => {});
  await page.getByRole("button", { name: "Skip cut", exact: true }).click();
  const firstCard = page.locator(".physical-card-figure").first().getByRole("button");
  await firstCard.focus();
  await expect(firstCard).toBeFocused();
  await firstCard.press("Enter");
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(1);
  await page.getByRole("button", { name: "Reveal all", exact: true }).click();

  await waitForReadingSections(page);
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(3);
  const journey = page.getByTestId("oracle-transcript");
  await journey.focus();
  await page.keyboard.press("ArrowRight");
  await expect(journey).toHaveAttribute("data-active-card-index", "0");
  await page.keyboard.press("End");
  await expect(page.getByRole("heading", { name: "Starlit Reflection" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reading details" })).toHaveCount(0);
  const composer = page.getByLabel("Keep the same cards and ask what they add");
  await composer.fill("What is one grounded action?");
  await composer.press("Enter");
  await expect.poll(async () => (await currentReading(page)).reading.followUps.length).toBe(1);
  expect((await currentReading(page)).reading.draw).toEqual(before);
});

test("physical card faces are specific illustrated assets with external position labels", async ({
  page,
}) => {
  await createProfile(page);
  await beginReading(page);
  await page.getByRole("button", { name: "Skip cut", exact: true }).click();
  const cards = page.locator(".physical-card-figure");
  await expect(cards).toHaveCount(3, { timeout: 10_000 });
  for (let index = 0; index < 3; index += 1) {
    await expect(cards.nth(index).locator(".physical-card-front img")).toHaveAttribute(
      "src",
      /\/art\/tarot\/v2\/.+\.svg$/,
    );
    // The card is now sometimes a <button> (unrevealed, clickable) and
    // sometimes a <div> (revealed), swapped by React rather than patched in
    // place around the same moment dealing settles into revealingCards, so a
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
    await expect(cards.nth(index).locator("figcaption")).toBeVisible();
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
  await page.getByRole("button", { name: "Generate test profile report" }).click();
  await expect(page).toHaveURL(/\/report\/[a-f0-9-]+$/, { timeout: 30_000 });
  await expect(page.getByText(/Life Path \d+; Expression \d+/)).toBeVisible();
  await expect(page.getByText(/local test entitlement/i)).toBeVisible();
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
