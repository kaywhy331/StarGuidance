import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

type ProfileKind = "unknown" | "exact" | "approximate";

async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`reader-${randomUUID()}@example.test`);
  await page.getByRole("button", { name: "Continue privately" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
}

async function createProfile(page: Page, kind: ProfileKind = "unknown") {
  await signIn(page);
  await page.getByLabel("Full birth name").fill("Ada Lovelace");
  await page.getByLabel("Date of birth").fill("1990-01-15");
  await page.getByLabel(new RegExp(`^${kind}`, "i")).check();
  if (kind !== "unknown") {
    await page.getByLabel("Add birthplace (optional)").check();
    await page.getByLabel("Birth city").fill("London");
    await page.getByLabel("Country code").fill("GB");
    await page.getByLabel("IANA timezone").fill("Europe/London");
  }
  if (kind === "exact") await page.getByLabel("Exact birth time").fill("08:15");
  if (kind === "approximate") {
    await page.getByLabel("Earliest time").fill("07:00");
    await page.getByLabel("Latest time").fill("09:00");
  }
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  await expect(page).toHaveURL(/\/readings$/);
}

async function beginReading(page: Page, question = "What should I focus on next?") {
  await page.getByLabel("Your private question").fill(question);
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/);
}

async function finishRitual(page: Page) {
  await page.getByRole("button", { name: "Finish shuffling" }).click();
  await page.getByRole("button", { name: "Skip cut" }).click();
  await page.getByRole("button", { name: "Reveal all" }).click();
  await page.getByRole("button", { name: "Open the reading" }).click();
  await expect(page.getByText("Central theme")).toBeVisible();
}

async function currentReading(page: Page) {
  const id = page.url().split("/").at(-1) as string;
  return page.evaluate(async (readingId) => {
    const response = await fetch(`/api/readings/${readingId}`, { cache: "no-store" });
    return (await response.json()) as {
      reading: {
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
});

test("exact birth details reach a completed reading", async ({ page }) => {
  await createProfile(page, "exact");
  const profile = await page.evaluate(async () => (await fetch("/api/profile")).json());
  expect(profile.profile.snapshot.completeness).toBe("complete");
  await beginReading(page, "How can I approach a new project?");
  await finishRitual(page);
});

test("approximate birth time remains a range through a completed reading", async ({ page }) => {
  await createProfile(page, "approximate");
  const profile = await page.evaluate(async () => (await fetch("/api/profile")).json());
  expect(profile.profile.snapshot.completeness).toBe("approximateTime");
  await beginReading(page, "What can support my next decision?");
  await finishRitual(page);
});

test("unknown birth time never fabricates astrology or BaZi", async ({ page }) => {
  await createProfile(page);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Purchase test report" }).click();
  await expect(page).toHaveURL(/\/report\/[a-f0-9-]+$/);
  await expect(page.getByText("Western astrology")).toBeVisible();
  await expect(page.getByText("BaZi Four Pillars")).toBeVisible();
  await expect(page.getByText("Explicitly unavailable")).toHaveCount(2);
});

test("AI-disabled mode returns the deterministic structured fallback", async ({ page }) => {
  await createProfile(page);
  await beginReading(page);
  await finishRitual(page);
  await expect(page.getByText(/Tarot is reflective guidance, not factual proof/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "What could disconfirm this?" })).toBeVisible();
});

test("an interrupted ritual recovers the identical locked draw", async ({ page }) => {
  await createProfile(page);
  await beginReading(page);
  const before = (await currentReading(page)).reading.draw;
  await page.reload();
  await expect(page.getByRole("button", { name: "Finish shuffling" })).toBeVisible();
  const after = (await currentReading(page)).reading.draw;
  expect(after).toEqual(before);
});

test("reduced-motion preference skips ritual transitions", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await createProfile(page);
  await beginReading(page);
  await expect(page.getByRole("button", { name: "Skip motion" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await finishRitual(page);
});

test("a follow-up uses the exact same cards", async ({ page }) => {
  await createProfile(page);
  await beginReading(page, "What should I notice in this relationship?");
  await finishRitual(page);
  const before = (await currentReading(page)).reading.draw;
  await page.getByLabel("Keep the same cards and ask what they add").fill("What can I do next?");
  await page.getByRole("button", { name: "Reflect on the same cards" }).click();
  await expect.poll(async () => (await currentReading(page)).reading.followUps.length).toBe(1);
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
  await page.getByRole("button", { name: "Finish shuffling" }).click();
  await page.getByRole("button", { name: "Skip cut" }).click();
  await page.getByRole("button", { name: "Reveal all" }).click();
  await page.getByRole("button", { name: "Retry the same draw" }).click();
  await page.getByRole("button", { name: "Open the reading" }).click();
  const after = (await currentReading(page)).reading.draw;
  expect(after).toEqual(before);
});

test("Stripe test-mode report entitlement uses the credential-free local adapter", async ({
  page,
}) => {
  await createProfile(page);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Purchase test report" }).click();
  await expect(page).toHaveURL(/\/report\/[a-f0-9-]+$/);
  await expect(page.getByText(/Life Path \d+; Expression \d+/)).toBeVisible();
  await expect(page.getByText(/local test entitlement/i)).toBeVisible();
});
