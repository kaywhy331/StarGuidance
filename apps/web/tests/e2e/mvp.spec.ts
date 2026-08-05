import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

type ProfileKind = "date-only" | "all-fields" | "time-only";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`reader-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue privately" }).click();
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

async function finishRitual(page: Page) {
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Opening theme" })).toBeVisible({
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
  const next = page.getByRole("button", { name: "Next reading section" });
  await expect(next).toBeEnabled();
  await next.click();
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
});

test("the ritual advances itself and reviews each card cinematically", async ({ page }) => {
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
  for (const removedControl of ["Finish shuffling", "Cut", "Skip cut", "Reveal all"])
    await expect(page.getByRole("button", { name: removedControl, exact: true })).toHaveCount(0);

  await finishRitual(page);
  const physicalCards = page.locator(".physical-card-figure");
  await expect(physicalCards.locator(".physical-tarot-card.is-revealed")).toHaveCount(3);
  const revealOrder = await page.evaluate(
    () => (window as typeof window & { __sgRevealOrder: string[] }).__sgRevealOrder,
  );
  expect(revealOrder.slice(0, 3)).toEqual(["0", "1", "2"]);
  const cinematicScales = await physicalCards.evaluateAll((cards) =>
    cards.map((card) => Number(card.style.getPropertyValue("--cinematic-scale"))),
  );
  expect(cinematicScales).toHaveLength(3);
  expect(cinematicScales.every((scale) => scale > 1)).toBe(true);
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
  await page.getByRole("button", { name: "Purchase test report" }).click();
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
  await page.reload();
  await expect(page.getByTestId("tarot-spread-stage")).toBeVisible({ timeout: 20_000 });
  const after = (await currentReading(page)).reading.draw;
  expect(after).toEqual(before);
});

test("reduced-motion preference skips ritual transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await createProfile(page);
  await beginReading(page);
  await expect(page.getByRole("button", { name: "Reduced motion" })).toHaveCount(0);
  await finishRitual(page);
  await expect(page.locator(".oracle-cursor")).toHaveCount(0);
  await expect(page.getByTestId("mystic-sanctuary-scene")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
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
  await page.getByRole("button", { name: "Previous reading section" }).click();
  await expect(page.getByRole("heading", { name: "Starlit Reflection" })).toBeVisible();
  await page.getByRole("button", { name: "Next reading section" }).click();
  await expect(page.getByRole("heading", { name: "The Cards Answer" })).toBeVisible();
  const after = (await currentReading(page)).reading.draw;
  expect(after).toEqual(before);
});

test("generation failure retries without a redraw", async ({ page }) => {
  await createProfile(page);
  const created = await page.evaluate(async () => {
    const response = await fetch("/api/readings", {
      method: "POST",
      headers: { "content-type": "application/json", "x-e2e-force-generation-failure": "1" },
      body: JSON.stringify({ spreadId: "direction", question: "What should I consider?" }),
    });
    return (await response.json()) as { readingId: string; generationStatus: string };
  });
  expect(created.generationStatus).toBe("failed");
  await page.goto(`/session/${created.readingId}`);
  const before = (await currentReading(page)).reading.draw;
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
  await page.evaluate(() => sessionStorage.setItem("sg:e2e-stream-fail-after", "2"));
  await expect(page.getByText(/Stream paused\. Received sections/i)).toBeVisible({
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

test("keyboard users traverse sections and submit a same-draw follow-up after the automatic reveal", async ({
  page,
}) => {
  await createProfile(page);
  await beginReading(page, "What should I practice in this conversation?");
  const before = (await currentReading(page)).reading.draw;
  await finishRitual(page);
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
  const cards = page.locator(".physical-card-figure");
  await expect(cards).toHaveCount(3, { timeout: 10_000 });
  for (let index = 0; index < 3; index += 1) {
    await expect(cards.nth(index).locator(".physical-card-front img")).toHaveAttribute(
      "src",
      /\/art\/tarot\/v2\/.+\.svg$/,
    );
    const ratio = await cards
      .nth(index)
      .locator(".physical-tarot-card")
      .evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.height / bounds.width;
      });
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
  await page.getByRole("button", { name: "Purchase test report" }).click();
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
