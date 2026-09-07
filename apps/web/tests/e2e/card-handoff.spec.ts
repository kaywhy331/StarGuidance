import { expect, test } from "@playwright/test";

import {
  createAccountAndProfileViaApi,
  reviewAndConfirmQuestion,
  type PreparedCeremony,
} from "./reading-helpers";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function center(box: Box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("the cards a reader picks are the cards that get dealt, with no cut between scenes", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await createAccountAndProfileViaApi(page);
  await page.goto("/readings");
  const prepared = await reviewAndConfirmQuestion(
    page,
    "What can I understand about the next step in my work?",
  );
  expect(prepared.status()).toBe(201);
  const { ceremony } = (await prepared.json()) as { ceremony: PreparedCeremony };
  const cardCount = ceremony.spread.positions.length;
  const scene = page.getByTestId("mystic-sanctuary-scene");
  const sceneElement = await scene.elementHandle();

  await expect(
    page.getByRole("button", { name: "Choose face-down card 1", exact: true }),
  ).toBeEnabled({ timeout: 20_000 });

  // Hold the locked reading's recovery so the picked shells can be measured
  // and captured while they are still the only cards on screen. Full-page
  // screenshots on emulated mobile devices can take more than a second.
  await page.route(
    (url) => /\/api\/readings\/[a-f0-9-]+$/.test(url.pathname),
    async (route) => {
      if (route.request().method() === "GET") await new Promise((r) => setTimeout(r, 2_500));
      await route.continue();
    },
  );
  const choices = [1, 78, 40, 2, 3, 4, 5, 6, 7, 8];
  for (const choice of choices.slice(0, cardCount))
    await page
      .getByRole("button", { name: `Choose face-down card ${choice}`, exact: true })
      .press("Enter");

  const picked = page.locator(".casino-card-shell.is-picked");
  await expect(picked).toHaveCount(cardCount);
  await expect(page.getByText("Locking your selected cards…")).toBeVisible();
  // Measure once every pick has finished its lift and slide.
  await expect
    .poll(
      () =>
        picked.evaluateAll((elements) =>
          elements.every((element) =>
            element.getAnimations().every((animation) => animation.playState !== "running"),
          ),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  const shells = await picked.evaluateAll((elements) =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        order: Number((element as HTMLElement).dataset["pickedOrder"]),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }),
  );
  expect(shells).toHaveLength(cardCount);
  // Record each card's very first on-screen box from inside the page. The
  // deal starts moving cards a few hundred milliseconds after the handoff,
  // sooner than a slow runner can round-trip a locator.
  await page.evaluate(() => {
    const held: Record<string, unknown> = {};
    const observer = new MutationObserver(() => {
      const figures = document.querySelectorAll<HTMLElement>(
        '[data-testid="tarot-spread-stage"] .physical-card-figure[data-deal-pose="awaiting"]',
      );
      if (figures.length === 0) return;
      for (const figure of figures) {
        const order = figure.dataset["spreadOrder"];
        if (order === undefined || order in held) continue;
        const rect = figure.querySelector(".physical-tarot-card")!.getBoundingClientRect();
        held[order] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
      if (Object.keys(held).length === figures.length) observer.disconnect();
    });
    observer.observe(document.body, {
      attributeFilter: ["data-deal-pose"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    (window as unknown as { __heldCards: Record<string, unknown> }).__heldCards = held;
  });
  await page.screenshot({ path: test.info().outputPath("1-picked-shells.png") });

  // The reading continues in the same scene: the sanctuary element survives
  // and the URL updates without a navigation.
  const stage = page.getByTestId("tarot-spread-stage");
  await expect(stage).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/);
  expect(await scene.elementHandle().then((handle) => handle?.evaluate((e) => e.isConnected))).toBe(
    true,
  );
  expect(
    await page.evaluate(
      (previous) => previous === document.querySelector('[data-testid="mystic-sanctuary-scene"]'),
      sceneElement,
    ),
  ).toBe(true);
  await expect(page.locator(".casino-card-shell")).toHaveCount(0);

  // Every card is mounted immediately; each first appears exactly where its
  // picked shell was, before the deal carries it into its slot.
  const figures = stage.locator(".physical-card-figure");
  await expect(figures).toHaveCount(cardCount);
  await page.screenshot({ path: test.info().outputPath("2-cards-holding-at-picks.png") });
  const held = await page.evaluate(
    () => (window as unknown as { __heldCards: Record<string, Box> }).__heldCards,
  );
  expect(Object.keys(held)).toHaveLength(cardCount);
  for (const shell of shells) {
    const card = held[String(shell.order)]!;
    expect(Math.abs(center(card).x - center(shell).x)).toBeLessThan(4);
    expect(Math.abs(center(card).y - center(shell).y)).toBeLessThan(4);
    expect(Math.abs(card.width - shell.width)).toBeLessThan(4);
  }
  const lastFigure = figures.nth(cardCount - 1);

  // The same elements are then dealt into their slots and stay mounted
  // through the reflection prompt: no remount, no second deck. A slow runner
  // may only observe the deal after it has already completed.
  const figureHandle = await lastFigure.elementHandle();
  await expect(scene).toHaveAttribute("data-ritual-phase", /^(dealing|awaitingReveal)$/, {
    timeout: 10_000,
  });
  await page.screenshot({ path: test.info().outputPath("3-dealt.png") });
  await expect(scene).toHaveAttribute("data-ritual-phase", "awaitingReveal", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("question-reflection")).toBeVisible();
  expect(await figureHandle?.evaluate((element) => element.isConnected)).toBe(true);
  await expect(lastFigure).not.toHaveAttribute("data-deal-pose", /./);
  await page.screenshot({ path: test.info().outputPath("4-reflection.png") });

  await expect(page.getByRole("button", { name: "I’m ready", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "I’m ready", exact: true }).click();
  await expect(scene).toHaveAttribute("data-ritual-phase", "revealing");
  expect(await figureHandle?.evaluate((element) => element.isConnected)).toBe(true);
  await page.getByRole("button", { name: "Reveal card 1, face down" }).press("Enter");
  await expect(page.locator(".physical-card-front img")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("5-reveal.png") });
});
