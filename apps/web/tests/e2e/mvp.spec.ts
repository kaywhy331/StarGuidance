import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  beginReadingThroughUi,
  completeRevealViaApi,
  createAccountAndProfile,
  createAccountAndProfileViaApi,
  finalizeReadingViaApi,
  prepareReadingViaApi,
  readOwnedReading,
  revealAllThroughUi,
} from "./reading-helpers";

test("onboarding keeps required and optional birth details in one private form", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(`onboarding-${randomUUID()}@example.test`);
  await page.getByLabel("Password").fill("synthetic-private-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(consent|onboarding)$/);
  if (new URL(page.url()).pathname === "/consent") {
    await page.getByLabel(/I accept the current Terms/i).check();
    await page.getByLabel(/I have read the current Privacy Notice/i).check();
    await page.getByLabel(/I confirm that I am at least 18/i).check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
  }

  const form = page.locator("form.onboarding-form");
  await expect(form.getByLabel("Full birth name")).toHaveAttribute("required", "");
  await expect(form.getByLabel("Date of birth")).toHaveAttribute("required", "");
  await expect(form.getByLabel("Birth city / country")).toBeVisible();
  await expect(form.getByLabel("Birth time")).toBeVisible();
  await expect(form.getByText("Name numerology", { exact: true })).toHaveCount(0);
  await expect(form.getByText("Dreamspell signature", { exact: true })).toHaveCount(0);
  await expect(form.getByText("Stable date traits", { exact: true })).toHaveCount(0);

  await form.getByLabel("Birth city / country").fill("London, United Kingdom");
  await form.getByRole("switch", { name: "I don't know my birthplace" }).check();
  await expect(form.getByLabel("Birth city / country")).toBeDisabled();
  await expect(form.getByLabel("Birth time")).toBeEnabled();
});

test("an explicitly mentioned saved person contributes only a minimized locked lens", async ({
  page,
}) => {
  test.setTimeout(150_000);
  await createAccountAndProfileViaApi(page);
  await page.goto("/people");
  await page.getByLabel("Full birth name *").fill("John Smith");
  await page.getByLabel("Date of birth *").fill("1991-06-12");
  await page.getByLabel("Birth city / country").fill("Seattle, United States");
  await page
    .getByLabel(/I have this person's permission to store their birth details privately/i)
    .check();
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/people",
  );
  await page.getByRole("button", { name: "Add person" }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.getByText("@john-smith", { exact: true })).toBeVisible();

  const ceremony = await prepareReadingViaApi(page, {
    question: "Why has @john-smith been distant lately?",
    personalizationMode: "personalized_tarot",
  });
  expect(ceremony.spread.id).toBe("relationship");
  const finalized = await finalizeReadingViaApi(page, ceremony);
  await completeRevealViaApi(page, finalized.readingId, ceremony.spread.positions.length, 0);

  const exported = await page.evaluate(async () => {
    const response = await fetch("/api/privacy/export", { cache: "no-store" });
    return { status: response.status, body: await response.json() };
  });
  expect(exported.status).toBe(200);
  const locked = exported.body.readings.find(
    (reading: { id: string }) => reading.id === finalized.readingId,
  ).relatedPersonLens;
  expect(locked.profiles[0]).toMatchObject({
    profileId: expect.any(String),
    snapshotId: expect.any(String),
    mention: "@john-smith",
  });
  expect(locked.profiles[0].traitStatements.length).toBeGreaterThan(0);
  expect(JSON.stringify(locked)).not.toMatch(/1991-06-12|Seattle|John Smith|birthDate/i);
});

test("one question directly prepares an automatic spread without exposing card assignments", async ({
  page,
}) => {
  await createAccountAndProfileViaApi(page);
  const question = "How can I work with the tension I feel around this project?";
  await expect(
    page.getByRole("heading", { name: "What question did you have for the stars today?" }),
  ).toBeVisible();
  await expect(page.getByText("Set your intention", { exact: true })).toHaveCount(0);
  await page.getByLabel("Your question for the stars").fill(question);
  const prepared = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/readings" &&
      response.request().postData()?.includes('"action":"prepare"') === true,
  );
  await page.getByRole("button", { name: "Send question" }).click();
  const response = await prepared;
  expect(response.status()).toBe(201);
  const payload = await response.json();
  expect(payload.ceremony.spread.id).toBe("three-card");
  expect(JSON.stringify(payload)).not.toMatch(/"cardId"|"assignments"|"orientation"/);
  await expect(page.locator(".casino-card-shell")).toHaveCount(78);
});

test("preparation commits the ritual but finalization atomically creates the first card records", async ({
  page,
}) => {
  await createAccountAndProfileViaApi(page);
  const ceremony = await prepareReadingViaApi(page, {
    question: "What should I understand about choosing my next work project?",
    spreadId: "three-card",
    personalizationMode: "pure_tarot",
  });

  expect(ceremony.serverSeedCommitment).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  expect(ceremony.spread.positions.map(({ id }) => id)).toEqual(["card-1", "card-2", "card-3"]);
  expect(JSON.stringify(ceremony)).not.toMatch(/"cardId"|"assignments"|"orientation"/);
  const beforeFinalization = await page.evaluate(
    async (id) =>
      fetch(`/api/readings/${id}`, { cache: "no-store" }).then((response) => response.status),
    ceremony.sessionId,
  );
  expect(beforeFinalization).toBe(404);

  const finalized = await finalizeReadingViaApi(page, ceremony, 39);
  expect(finalized.readingId).toBe(ceremony.sessionId);
  expect(finalized.drawProof).toMatchObject({ cutIndex: 39, reversalMode: "reversals_enabled" });
  const owned = await readOwnedReading(page, finalized.readingId);
  expect(owned.status).toBe(200);
  expect(owned.body.reading.draw.proof.cutIndex).toBe(39);
  expect(owned.body.reading.draw.assignments).toHaveLength(3);
  expect(new Set(owned.body.reading.draw.assignments.map(({ cardId }) => cardId)).size).toBe(3);
  expect(owned.body.reading.draw.assignments.map(({ positionId }) => positionId)).toEqual(
    ceremony.spread.positions.map(({ id }) => id),
  );
  expect(owned.body.reading.result).toBeUndefined();

  const streamStatus = await page.evaluate(
    async (id) =>
      fetch(`/api/readings/${id}/stream?target=primary`, { cache: "no-store" }).then(
        (response) => response.status,
      ),
    finalized.readingId,
  );
  expect(streamStatus).toBe(409);
});

test("the optional cut is recorded and upright-only remains a legitimate reading method", async ({
  page,
}) => {
  await createAccountAndProfileViaApi(page);
  const ceremony = await prepareReadingViaApi(page, {
    spreadId: "outlook",
    question: "How may this plan develop over the next month?",
    reversalMode: "upright_only",
    personalizationMode: "pure_tarot",
  });
  const finalized = await finalizeReadingViaApi(page, ceremony, 58);
  const owned = await readOwnedReading(page, finalized.readingId);

  expect(owned.body.reading.configuration.reversalMode).toBe("upright_only");
  expect(owned.body.reading.draw.proof).toMatchObject({
    cutIndex: 58,
    reversalMode: "upright_only",
  });
  expect(owned.body.reading.draw.assignments).toHaveLength(7);
  expect(
    owned.body.reading.draw.assignments.every(({ orientation }) => orientation === "upright"),
  ).toBe(true);
});

test("users may choose reveal order while exposing only one locked baseline", async ({ page }) => {
  test.setTimeout(150_000);
  await createAccountAndProfileViaApi(page);
  await beginReadingThroughUi(page, {
    cutButton: "Cut at the center",
    question: "What should I understand about moving this project forward?",
  });

  const motionControl = page.getByRole("button", { name: /^Reduced motion/ });
  if ((await motionControl.getAttribute("aria-pressed")) !== "true")
    await motionControl.dispatchEvent("click");
  await expect(page.getByTestId("mystic-sanctuary-scene")).toHaveAttribute(
    "data-ritual-phase",
    "awaitingReveal",
    { timeout: 20_000 },
  );
  await expect(page.locator(".physical-card-front")).toHaveCount(0);
  await expect(page.getByTestId("oracle-transcript")).toHaveCount(0);
  await page.getByRole("button", { name: "I’m ready" }).click();
  await page.getByRole("button", { name: "Reveal card 3, face down" }).click();

  const revealedPanel = page.getByTestId("guided-reveal-panel");
  await expect(revealedPanel).toContainText("Direction");
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(1);
  await expect(page.locator(".physical-card-front")).toHaveCount(1);
  await expect(page.getByTestId("oracle-transcript")).toHaveCount(0);

  await page.getByRole("button", { name: /Return to the spread/ }).click();
  await page.getByRole("button", { name: "Reveal All" }).click();
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("reading-active-passage")).toBeVisible();
  await expect(page.getByTestId("reading-active-passage")).toHaveCount(1);
});

const spreadContracts = [
  {
    id: "one-card",
    count: 1,
    question: "What is most important for me to notice now?",
    trajectory: false,
    alternate: false,
  },
  {
    id: "three-card",
    count: 3,
    question: "How can I understand the uncertainty I feel about work right now?",
    trajectory: true,
    alternate: false,
  },
  {
    id: "crossroads",
    count: 5,
    question: "Should I choose the promotion or remain in my current role?",
    trajectory: false,
    alternate: true,
  },
  {
    id: "outlook",
    count: 7,
    question: "How may my work transition unfold over the coming months?",
    trajectory: true,
    alternate: false,
  },
] as const;

for (const contract of spreadContracts) {
  test(`the ${contract.id} result follows its configured capabilities`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name.startsWith("mobile") && contract.id !== "three-card",
      "The mobile project exercises the representative three-card lifecycle.",
    );
    await createAccountAndProfileViaApi(page);
    const ceremony = await prepareReadingViaApi(page, {
      spreadId: contract.id,
      question: contract.question,
      personalizationMode: "pure_tarot",
    });
    const finalized = await finalizeReadingViaApi(page, ceremony, 20);
    await completeRevealViaApi(page, finalized.readingId, contract.count, 20);
    const owned = await readOwnedReading(page, finalized.readingId);
    const result = owned.body.reading.result;

    expect(result).toBeDefined();
    expect(result!.cards).toHaveLength(contract.count);
    expect(result!.cards.map(({ positionId }) => positionId)).toEqual(
      ceremony.spread.positions.map(({ id }) => id),
    );
    for (const card of result!.cards) {
      expect(card.supportingEvidence.length).toBeGreaterThan(0);
      expect(card.positionId).toBeTruthy();
      expect(card.cardId).toBeTruthy();
      expect(card.orientation).toMatch(/upright|reversed/);
    }
    expect(result!.directAnswer).not.toBe("");
    expect(result!.synthesis).not.toBe("");
    expect(result!.userAgency).not.toBe("");
    expect(result!.reflectionPrompt).not.toBe("");
    expect(result!.uncertaintyNote).not.toBe("");
    expect(Boolean(result!.likelyTrajectory)).toBe(contract.trajectory);
    expect(Boolean(result!.alternatePath)).toBe(contract.alternate);
    expect(result!.timing).toBeNull();
    expect(result!.personalizationLens).toBeNull();
  });
}

const configuredSpreadCases = [
  {
    id: "one-card",
    kind: "centered",
    positions: [[0, 0, 0]],
  },
  {
    id: "three-card",
    kind: "horizontal",
    positions: [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ],
  },
  {
    id: "crossroads",
    kind: "legacy",
    positions: [
      [1, 2, 0],
      [1, 0, 0],
      [0, 1, 0],
      [2, 1, 0],
      [1, 1, 0],
    ],
  },
  {
    id: "outlook",
    kind: "legacy",
    positions: [
      [0, 2, 0],
      [1, 2, 0],
      [2, 2, 0],
      [0, 1, 0],
      [2, 1, 0],
      [0, 0, 0],
      [2, 0, 0],
    ],
  },
  {
    id: "celtic-cross",
    kind: "celtic-cross",
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

for (const spreadCase of configuredSpreadCases) {
  test(`configured ${spreadCase.id} spread uses its spatial arrangement`, async ({ page }) => {
    test.setTimeout(120_000);
    await createAccountAndProfileViaApi(page);
    const ceremony = await prepareReadingViaApi(page, {
      spreadId: spreadCase.id,
      question: "What should I understand about the path in front of me?",
      personalizationMode: "pure_tarot",
    });
    const finalized = await finalizeReadingViaApi(page, ceremony, 20);
    await page.goto(`/session/${finalized.readingId}`);

    const motionControl = page.getByRole("button", { name: /^Reduced motion/ });
    await expect(motionControl).toBeVisible({ timeout: 20_000 });
    if ((await motionControl.getAttribute("aria-pressed")) !== "true")
      await motionControl.dispatchEvent("click");
    await expect(page.getByTestId("mystic-sanctuary-scene")).toHaveAttribute(
      "data-ritual-phase",
      "awaitingReveal",
      { timeout: 20_000 },
    );

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
  });
}

test("refresh, replay, and same-question clarification preserve the exact locked draw", async ({
  page,
}) => {
  await createAccountAndProfileViaApi(page);
  const ceremony = await prepareReadingViaApi(page, {
    question: "What can help me move this work project forward this month?",
    personalizationMode: "pure_tarot",
  });
  const finalized = await finalizeReadingViaApi(page, ceremony, 20);
  const before = (await readOwnedReading(page, finalized.readingId)).body.reading.draw;

  const replay = await page.evaluate(async (token) => {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const response = await fetch("/api/readings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "finalize",
        ceremonyToken: token,
        clientNonce: btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""),
        cutIndex: 20,
      }),
    });
    return { body: await response.json(), status: response.status };
  }, ceremony.token);
  expect(replay.status).toBe(200);
  expect(replay.body).toMatchObject({ readingId: finalized.readingId, idempotentReplay: true });

  await completeRevealViaApi(page, finalized.readingId, 3, 20);
  const sameScope = await page.evaluate(async (id) => {
    const response = await fetch(`/api/readings/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "followUp",
        question: "What is one practical way to move this same project forward this month?",
      }),
    });
    return { body: await response.json(), status: response.status };
  }, finalized.readingId);
  expect(sameScope.status).toBe(201);
  expect((await readOwnedReading(page, finalized.readingId)).body.reading.draw).toEqual(before);

  const newScope = await page.evaluate(async (id) => {
    const response = await fetch(`/api/readings/${id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "followUp",
        question: "How should I approach a new romantic relationship next year?",
      }),
    });
    return { body: await response.json(), status: response.status };
  }, finalized.readingId);
  expect(newScope.status).toBe(409);
  expect(newScope.body).toMatchObject({ newReadingRequired: true });

  await page.goto(`/session/${finalized.readingId}`);
  await page.reload();
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("tarot-spread-stage")).toBeVisible();
  await expect(page.locator(".physical-tarot-card.is-revealed")).toHaveCount(3);
  await expect(page.getByTestId("mystic-sanctuary-scene")).toHaveAttribute(
    "data-reading-focus",
    "reading",
  );
  expect((await readOwnedReading(page, finalized.readingId)).body.reading.draw).toEqual(before);
});

test("reduced-motion users can reveal all and reach a spread-aware reading", async ({ page }) => {
  test.setTimeout(150_000);
  await createAccountAndProfileViaApi(page);
  await beginReadingThroughUi(page, {
    question: "What should I understand about my next grounded choice?",
  });
  await revealAllThroughUi(page);
  await expect(page.getByTestId("reading-journey")).toHaveAttribute("data-reading-mode", "section");
  await expect(page.getByRole("heading", { name: "Your answer", exact: true })).toBeVisible();
  await expect(page.getByTestId("reading-active-passage")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "The thread" })).toHaveCount(0);
});

test("profile snapshots remain pinned after later birth-data updates", async ({ page }) => {
  await createAccountAndProfile(page, {
    birthTime: "08:15",
    birthplace: "London, United Kingdom",
  });
  const beforeProfile = await page.evaluate(async () =>
    fetch("/api/profile", { cache: "no-store" }).then((response) => response.json()),
  );
  const ceremony = await prepareReadingViaApi(page);
  const finalized = await finalizeReadingViaApi(page, ceremony);
  const originalReading = await page.evaluate(
    async (id) =>
      fetch(`/api/readings/${id}`, { cache: "no-store" }).then((response) => response.json()),
    finalized.readingId,
  );
  expect(originalReading.reading.profileSnapshotId).toBe(beforeProfile.profile.snapshot.id);

  await page.goto("/onboarding");
  await page.getByLabel("Birth city / country").fill("Edinburgh, United Kingdom");
  await page
    .getByRole("checkbox", { name: /I consent to the private use of my birth details/i })
    .check();
  await page.getByRole("button", { name: "Save updated profile" }).click();
  await expect(page).toHaveURL(/\/readings$/, { timeout: 30_000 });
  const afterProfile = await page.evaluate(async () =>
    fetch("/api/profile", { cache: "no-store" }).then((response) => response.json()),
  );
  expect(afterProfile.profile.snapshot.id).not.toBe(beforeProfile.profile.snapshot.id);
  const unchanged = await page.evaluate(
    async (id) =>
      fetch(`/api/readings/${id}`, { cache: "no-store" }).then((response) => response.json()),
    finalized.readingId,
  );
  expect(unchanged.reading.profileSnapshotId).toBe(beforeProfile.profile.snapshot.id);
});

test("the credential-free local report adapter still grants the test entitlement", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "The report adapter is viewport-neutral.");
  await createAccountAndProfileViaApi(page);
  await page.goto("/profile");
  await page.getByRole("button", { name: "Get full profile report" }).click();
  await expect(page).toHaveURL(/\/report\/[a-f0-9-]+$/, { timeout: 30_000 });
  await expect(page.getByText(/local test adapter/i)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Western astrology", exact: true })).toBeVisible();
  await expect(page.locator("#atlas-section-astrology")).toContainText("Explicitly unavailable");
});
