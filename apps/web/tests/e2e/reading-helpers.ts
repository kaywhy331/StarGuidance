import { randomUUID } from "node:crypto";

import { expect, type Page } from "@playwright/test";

import { POLICY_VERSIONS } from "../../src/lib/policies";

export interface PreparedCeremony {
  readonly sessionId: string;
  readonly token: string;
  readonly serverSeedCommitment: string;
  readonly question: string;
  readonly spread: {
    readonly id: string;
    readonly version: string;
    readonly positions: readonly {
      readonly id: string;
      readonly displayName: string;
      readonly interpretiveFunction: string;
      readonly order: number;
    }[];
  };
  readonly configuration: {
    readonly reversalMode: "reversals_enabled" | "upright_only";
    readonly personalizationMode: "pure_tarot" | "personalized_tarot";
  };
}

export async function createAccountAndProfile(
  page: Page,
  fields: {
    birthName?: string;
    birthDate?: string;
    birthplace?: string;
    birthTime?: string;
  } = {},
) {
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
  await page.getByLabel("Full birth name").fill(fields.birthName ?? "Ada Lovelace");
  await page.getByLabel("Date of birth").fill(fields.birthDate ?? "1990-01-15");
  if (fields.birthplace) await page.getByLabel("Birth city / country").fill(fields.birthplace);
  if (fields.birthTime) await page.getByLabel("Birth time").fill(fields.birthTime);
  await page
    .getByRole("checkbox", { name: /I consent to the private use of my birth details/i })
    .check();
  await page.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).toHaveURL(/\/readings$/, { timeout: 30_000 });
}

export async function createAccountAndProfileViaApi(page: Page) {
  await page.goto("/");
  const result = await page.evaluate(
    async ({ email, policies }) => {
      const authResponse = await fetch("/api/auth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "sign-up",
          email,
          password: "synthetic-private-password",
          displayName: "Lifecycle Reader",
          consents: {
            termsAccepted: true,
            termsVersion: policies.terms,
            privacyAccepted: true,
            privacyVersion: policies.privacy,
            ageConfirmed: true,
            ageEligibilityVersion: policies.ageEligibility,
            marketingAccepted: false,
            marketingVersion: policies.marketing,
          },
        }),
      });
      if (!authResponse.ok)
        return {
          authBody: await authResponse.text(),
          authStatus: authResponse.status,
          profileBody: "",
          profileStatus: 0,
        };
      const profileResponse = await fetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fullBirthName: "Ada Lovelace",
          birthDate: "1990-01-15",
          consentVersion: policies.profilePersonalization,
        }),
      });
      return {
        authBody: "",
        authStatus: authResponse.status,
        profileBody: await profileResponse.text(),
        profileStatus: profileResponse.status,
      };
    },
    { email: `lifecycle-${randomUUID()}@example.test`, policies: POLICY_VERSIONS },
  );
  expect(
    result,
    `Synthetic profile setup failed: ${result.profileBody || result.authBody}`,
  ).toMatchObject({ authStatus: 200, profileStatus: 201 });
  await page.goto("/readings");
  await expect(page.getByLabel("Your private question")).toBeVisible();
}

export async function reviewAndConfirmQuestion(page: Page, question: string) {
  await expect(page.getByLabel("Your private question")).toBeVisible();
  await page.getByLabel("Your private question").fill(question);
  const reviewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/readings" &&
      response.request().postData()?.includes('"action":"review"') === true,
  );
  await page.getByRole("button", { name: "Review my question" }).click();
  expect((await reviewResponse).status()).toBe(200);
  await expect(page.getByTestId("question-confirmation")).toContainText(question);
  await page.getByRole("button", { name: "Confirm this question" }).click();
}

export async function prepareReadingViaApi(
  page: Page,
  options: {
    spreadId?: string;
    question?: string;
    reversalMode?: "reversals_enabled" | "upright_only";
    personalizationMode?: "pure_tarot" | "personalized_tarot";
    continueAsReflection?: boolean;
  } = {},
): Promise<PreparedCeremony> {
  const result = await page.evaluate(async (input) => {
    const response = await fetch("/api/readings", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        action: "prepare",
        spreadId: input.spreadId ?? "three-card",
        question: input.question ?? "What should I understand about my next grounded step?",
        questionConfirmed: true,
        reversalMode: input.reversalMode ?? "reversals_enabled",
        personalizationMode: input.personalizationMode ?? "personalized_tarot",
        continueAsReflection: input.continueAsReflection ?? false,
      }),
    });
    return { body: await response.text(), status: response.status };
  }, options);
  expect(result.status, `Reading preparation failed: ${result.body}`).toBe(201);
  const payload = JSON.parse(result.body) as { ceremony: PreparedCeremony };
  expect(payload.ceremony.token.length).toBeGreaterThan(32);
  return payload.ceremony;
}

export async function finalizeReadingViaApi(
  page: Page,
  ceremony: PreparedCeremony,
  cutIndex = 0,
): Promise<{ readingId: string; drawProof: { cutIndex: number; reversalMode: string } }> {
  const result = await page.evaluate(
    async ({ ceremonyToken, selectedCutIndex }) => {
      const bytes = crypto.getRandomValues(new Uint8Array(32));
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const clientNonce = btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
      const response = await fetch("/api/readings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "finalize",
          ceremonyToken,
          clientNonce,
          cutIndex: selectedCutIndex,
        }),
      });
      return { body: await response.text(), status: response.status };
    },
    { ceremonyToken: ceremony.token, selectedCutIndex: cutIndex },
  );
  expect(result.status, `Draw finalization failed: ${result.body}`).toBe(201);
  return JSON.parse(result.body) as {
    readingId: string;
    drawProof: { cutIndex: number; reversalMode: string };
  };
}

export async function completeRevealViaApi(
  page: Page,
  readingId: string,
  cardCount: number,
  cutIndex: number,
) {
  const result = await page.evaluate(
    async ({ id, count, cut }) => {
      const response = await fetch(`/api/readings/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "progress",
          phase: "fullSpreadReady",
          cutIndex: cut,
          revealedIndexes: Array.from({ length: count }, (_, index) => index),
        }),
      });
      return { body: await response.text(), status: response.status };
    },
    { id: readingId, count: cardCount, cut: cutIndex },
  );
  expect(result.status, `Reveal completion failed: ${result.body}`).toBe(200);
}

export async function readOwnedReading(page: Page, readingId: string) {
  return page.evaluate(async (id) => {
    const response = await fetch(`/api/readings/${id}`, { cache: "no-store" });
    return {
      body: (await response.json()) as {
        reading: {
          cards: readonly {
            cardId: string;
            orientation: "upright" | "reversed";
            positionId: string;
          }[];
          configuration: {
            reversalMode: "reversals_enabled" | "upright_only";
            personalizationMode: "pure_tarot" | "personalized_tarot";
            positions: readonly { id: string; displayName: string; order: number }[];
          };
          draw: {
            assignments: readonly {
              positionId: string;
              cardId: string;
              orientation: "upright" | "reversed";
            }[];
            proof: { cutIndex: number; reversalMode: string };
          };
          result?: {
            directAnswer: string;
            cards: readonly {
              positionId: string;
              cardId: string;
              orientation: "upright" | "reversed";
              relationshipNotes: readonly string[];
              supportingEvidence: readonly string[];
            }[];
            synthesis: string;
            likelyTrajectory: string | null;
            alternatePath: string | null;
            timing: string | null;
            userAgency: string;
            reflectionPrompt: string;
            uncertaintyNote: string;
            personalizationLens: { label: string; observations: readonly string[] } | null;
          };
          ritualProgress: {
            phase: string;
            cutIndex: number;
            revealedIndexes: readonly number[];
          };
        };
      },
      status: response.status,
    };
  }, readingId);
}

export async function beginReadingThroughUi(
  page: Page,
  options: {
    question?: string;
    spreadId?: "one-card" | "three-card" | "crossroads" | "outlook";
    spreadName?: string;
    cutButton?: "Cut near the top" | "Cut at the center" | "Cut deeper" | "No cut";
  } = {},
) {
  const question = options.question ?? "What should I understand about my next grounded step?";
  const spreadId = options.spreadId ?? "three-card";
  await reviewAndConfirmQuestion(page, question);
  await page.locator(`input[name="spread"][value="${spreadId}"]`).check();
  await expect(page.getByTestId("spread-position-preview")).toBeVisible();
  const spreadLabel =
    options.spreadName ??
    {
      "one-card": "Single Card — Focus",
      "three-card": "Three Cards — Situation, Challenge, Direction",
      crossroads: "Five Cards — Crossroads",
      outlook: "Seven Cards — Deeper Outlook",
    }[spreadId];
  const preparation = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/readings" &&
      response.request().postData()?.includes('"action":"prepare"') === true,
  );
  await page.getByRole("button", { name: `Confirm ${spreadLabel}` }).click();
  const preparedResponse = await preparation;
  expect(preparedResponse.status()).toBe(201);
  const preparedBody = await preparedResponse.json();
  expect(JSON.stringify(preparedBody)).not.toMatch(/"cardId"|"assignments"|"orientation"/);
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  await expect(page.getByTestId("mystic-sanctuary-scene")).toHaveAttribute(
    "data-ritual-phase",
    "shuffling",
  );
  await page.getByRole("button", { name: "Finish shuffling" }).click();
  await expect(page.getByText("Cut the deck, if you wish")).toBeVisible();
  const finalization = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/readings" &&
      response.request().postData()?.includes('"action":"finalize"') === true,
  );
  const cutChoice = options.cutButton ?? "No cut";
  if (cutChoice === "No cut") {
    await page.getByRole("button", { name: "Continue without a cut" }).click();
  } else {
    const cutIndex = {
      "Cut near the top": 20,
      "Cut at the center": 39,
      "Cut deeper": 58,
    }[cutChoice];
    const deck = page.getByTestId("ritual-cut-deck");
    const bounds = await deck.boundingBox();
    if (!bounds) throw new Error("The immersive cut deck is not visible.");
    await deck.click({
      position: { x: bounds.width / 2, y: (bounds.height * cutIndex) / 78 },
    });
  }
  expect((await finalization).status()).toBe(201);
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 30_000 });
  return page.url().split("/").at(-1) as string;
}

export async function revealAllThroughUi(page: Page) {
  const motionControl = page.getByRole("button", { name: /^Reduced motion/ });
  if ((await motionControl.getAttribute("aria-pressed")) !== "true")
    await motionControl.dispatchEvent("click");
  await expect(page.getByTestId("mystic-sanctuary-scene")).toHaveAttribute(
    "data-ritual-phase",
    "awaitingReveal",
    { timeout: 20_000 },
  );
  await expect(page.getByTestId("question-reflection")).toBeVisible();
  await page.getByRole("button", { name: /^(I’m ready|Continue revealing)$/ }).click();
  await page.getByRole("button", { name: "Reveal All" }).click();
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("tarot-spread-stage")).toHaveCount(0);
  await expect(page.getByTestId("mystic-sanctuary-scene")).toHaveAttribute(
    "data-reading-focus",
    "reading",
  );
}
