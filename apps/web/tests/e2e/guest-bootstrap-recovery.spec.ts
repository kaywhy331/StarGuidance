import { randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";
import { POLICY_VERSIONS } from "../../src/lib/policies";

// Focused executed-fixture source; status is recorded in run evidence. Real local authentication, page effects and browser storage.
// Controlled 410/503 responses qualify client wiring; they do not prove token expiry
// or Supabase deletion. Successful fallback uses the real local continuation API.
const KEYS = {
  receipt: "sg:guest-reading-receipt:v1",
  handoff: "sg:guest-reading-handoff:v1",
  pending: "sg:guest-reading:v2",
  device: "sg:guest-device:v1",
  trial: "sg:guest-trial-used:v1",
  draft: "sg:guest-intake-draft:v1",
};
const PASSWORD = "synthetic-private-password";
const EXPIRED_HEADING = "Your saved guest reading expired after 7 days.";
const expired = { error: EXPIRED_HEADING, expired: true };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function reply(route: Route, status: number, body: unknown) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function setup(page: Page, baseURL: string | undefined, threeCard = false) {
  if (!baseURL || !["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname)) {
    throw new Error("Prepared fixture is restricted to the local test server");
  }
  const health = await page.request.get("/api/health");
  expect(await health.json()).toMatchObject({ appEnvironment: "test", runtimeAdapter: "local" });
  const origin = new URL(baseURL).origin;
  const device = randomUUID();
  const headers = { origin, "x-starguidance-guest-device": device };
  const prepared = await page.request.post("/api/guest-readings", {
    headers,
    data: {
      action: "prepare",
      question: threeCard
        ? "How can I prepare for the next step in my work?"
        : "What deserves my attention today?",
      questionConfirmed: true,
      personalizationMode: "pure_tarot",
      termsAccepted: true,
      privacyAccepted: true,
      ageConfirmed: true,
    },
  });
  expect(prepared.ok()).toBe(true);
  const { ceremony } = await prepared.json();
  if (threeCard) expect(ceremony.spread.positions).toHaveLength(3);
  const finalized = await page.request.post("/api/guest-readings", {
    headers,
    data: {
      action: "finalize",
      ceremonyToken: ceremony.token,
      clientNonce: randomBytes(32).toString("base64url"),
      cutIndex: 0,
      selectedIndexes: ceremony.spread.positions.map((_: unknown, index: number) => index),
    },
  });
  expect(finalized.status()).toBe(201);
  const guest = (await finalized.json()) as {
    receipt: string;
    handoff: string;
    reading: { cards: { cardId: string; orientation: string }[] };
  };
  expect(guest.handoff).toMatch(/^h1\./);
  if (threeCard) expect(guest.reading.cards).toHaveLength(3);
  const guestCookies = await page.context().cookies();
  const signup = await page.request.post("/api/auth", {
    headers: { origin },
    data: {
      action: "sign-up",
      email: `expiry-${randomUUID()}@example.test`,
      password: PASSWORD,
      displayName: "Synthetic Reader",
      consents: {
        termsAccepted: true,
        termsVersion: POLICY_VERSIONS.terms,
        privacyAccepted: true,
        privacyVersion: POLICY_VERSIONS.privacy,
        ageConfirmed: true,
        ageEligibilityVersion: POLICY_VERSIONS.ageEligibility,
        marketingAccepted: false,
        marketingVersion: POLICY_VERSIONS.marketing,
      },
    },
  });
  expect(signup.ok()).toBe(true);
  await page.goto("/settings/privacy");
  await expect(
    page.getByRole("heading", { name: "Delete your account", exact: true }),
  ).toBeVisible();
  return { ...guest, device, guestCookies };
}

async function seed(page: Page, receipt: string, handoff?: string, device = randomUUID()) {
  await page.evaluate(
    ({ keys, receipt, handoff, device }) => {
      localStorage.setItem(keys.receipt, receipt);
      if (handoff) localStorage.setItem(keys.handoff, handoff);
      else localStorage.removeItem(keys.handoff);
      localStorage.setItem(keys.device, device);
      localStorage.setItem(keys.trial, "1");
      sessionStorage.setItem(
        keys.pending,
        JSON.stringify({
          kind: "receipt",
          receipt,
          revealedIndexes: [0],
          resultUnlocked: true,
        }),
      );
      sessionStorage.setItem(
        keys.draft,
        JSON.stringify({ question: "Synthetic draft", consented: true, personalize: false }),
      );
    },
    { keys: KEYS, receipt, handoff, device },
  );
}

async function storage(page: Page) {
  return page.evaluate(
    (keys) => ({
      receipt: localStorage.getItem(keys.receipt),
      handoff: localStorage.getItem(keys.handoff),
      pending: sessionStorage.getItem(keys.pending),
      device: localStorage.getItem(keys.device),
      trial: localStorage.getItem(keys.trial),
      draft: sessionStorage.getItem(keys.draft),
    }),
    KEYS,
  );
}

async function expectUnchanged(page: Page, before: Awaited<ReturnType<typeof storage>>) {
  await expect.poll(() => storage(page)).toEqual(before);
}

async function anonymousCopies(page: Page, baseURL: string | undefined, threeCard = false) {
  const guest = await setup(page, baseURL, threeCard);
  const recovered = await page.request.post("/api/guest-readings/continue", {
    headers: { origin: new URL(baseURL!).origin },
    data: { action: "redeem", handoff: guest.handoff },
  });
  expect(recovered.status()).toBe(200);
  const fresh = await recovered.json();
  expect(fresh.receipt).not.toBe(guest.receipt);
  expect(fresh.reading.cards).toEqual(guest.reading.cards);
  if (threeCard) expect(fresh.reading.cards).toHaveLength(3);
  await seed(page, guest.receipt, guest.handoff, guest.device);
  await page.evaluate(
    ({ keys, freshReceipt }) => {
      localStorage.setItem(keys.receipt, freshReceipt);
      const pending = JSON.parse(sessionStorage.getItem(keys.pending)!);
      pending.revealedIndexes = [0, 1];
      pending.resultUnlocked = false;
      sessionStorage.setItem(keys.pending, JSON.stringify(pending));
    },
    { keys: KEYS, freshReceipt: fresh.receipt },
  );
  await page.context().clearCookies();
  await page.context().addCookies(guest.guestCookies);
  expect((await page.request.get("/api/readings")).status()).toBe(401);
  await page.emulateMedia({ reducedMotion: "reduce" });
  return { guest, fresh, before: await storage(page) };
}

for (const failure of ["503", "network"] as const) {
  test(`anonymous bootstrap preserves pending reveal progress when ${failure} is followed by a successful stored receipt`, async ({
    page,
    baseURL,
  }) => {
    const { guest, fresh, before } = await anonymousCopies(page, baseURL, true);
    const attempts: string[] = [];
    await page.route("**/api/guest-readings", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON();
      attempts.push(
        body.receipt === guest.receipt
          ? "pending"
          : body.receipt === fresh.receipt
            ? "stored"
            : "other",
      );
      if (body.receipt === guest.receipt) {
        if (failure === "network") return route.abort("failed");
        return reply(route, 503, { error: "Synthetic temporary recovery failure" });
      }
      return route.continue();
    });
    await page.goto("/free-reading");
    await expect(page.getByTestId("guest-notice")).toContainText("Welcome back");
    const after = await storage(page);
    console.log(
      JSON.stringify({
        gate: "partial-recovery",
        cardCount: guest.reading.cards.length,
        failure,
        attempts,
        pendingPreserved: after.pending === before.pending,
        storedReceiptRecovered: after.receipt === fresh.receipt,
        progressBefore: { ...JSON.parse(before.pending!), receipt: "redacted-synthetic" },
        progressAfter: after.pending
          ? { ...JSON.parse(after.pending), receipt: "redacted-synthetic" }
          : null,
      }),
    );
    expect(attempts).toEqual(["pending", "stored"]);
    expect(after.receipt).toBe(fresh.receipt);
    expect(after.pending === before.pending, "pending receipt and reveal progress preserved").toBe(
      true,
    );
    // After the transient failure is gone, the original pending copy still
    // reopens with its exact progress rather than silently starting over.
    await page.unroute("**/api/guest-readings");
    await page.reload();
    await expect(page.getByTestId("guest-notice")).toContainText("Welcome back");
    expect(JSON.parse((await storage(page)).pending!)).toMatchObject({
      revealedIndexes: [0, 1],
      resultUnlocked: false,
    });
    await expect(page.getByText("2 of 3", { exact: true })).toBeVisible();
    expect((await page.request.get("/api/readings")).status()).toBe(401);
  });
}

for (const abortAt of ["pending", "stored"] as const) {
  test(`anonymous bootstrap abort at ${abortAt} settles without deleting copies or starting another attempt`, async ({
    page,
    baseURL,
  }) => {
    const { guest, fresh, before } = await anonymousCopies(page, baseURL);
    await page.addInitScript(() => {
      const probe = {
        documentId: crypto.randomUUID(),
        requests: 0,
        aborts: 0,
        settled: 0,
        eligibilityRequests: 0,
      };
      (window as unknown as { bootstrapProbe: typeof probe }).bootstrapProbe = probe;
      const original = window.fetch.bind(window);
      window.fetch = async (...args) => {
        const options = args[1];
        if (!String(args[0]).endsWith("/api/guest-readings")) return original(...args);
        if (options?.method !== "POST") {
          probe.eligibilityRequests += 1;
          return original(...args);
        }
        probe.requests += 1;
        options.signal?.addEventListener(
          "abort",
          () => {
            probe.aborts += 1;
          },
          { once: true },
        );
        try {
          return await original(...args);
        } finally {
          probe.settled += 1;
        }
      };
    });
    const received = deferred();
    const release = deferred();
    const finished = deferred();
    const attempts: string[] = [];
    await page.route("**/api/guest-readings", async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const body = route.request().postDataJSON();
      const copy =
        body.receipt === guest.receipt
          ? "pending"
          : body.receipt === fresh.receipt
            ? "stored"
            : "other";
      attempts.push(copy);
      if (copy !== abortAt)
        return reply(route, 503, { error: "Synthetic temporary recovery failure" });
      received.resolve();
      await release.promise;
      try {
        await reply(route, 410, expired);
      } catch {
        /* request already aborted */
      } finally {
        finished.resolve();
      }
    });
    try {
      await page.goto("/free-reading");
      await received.promise;
      const probe = () =>
        page.evaluate(
          () =>
            (
              window as unknown as {
                bootstrapProbe: {
                  documentId: string;
                  requests: number;
                  aborts: number;
                  settled: number;
                  eligibilityRequests: number;
                };
              }
            ).bootstrapProbe,
        );
      const documentId = (await probe()).documentId;
      await page
        .getByRole("contentinfo")
        .getByRole("link", { name: "StarGuidance", exact: true })
        .click();
      await expect(page).toHaveURL(new URL("/", baseURL!).toString());
      release.resolve();
      await finished.promise;
      await expect.poll(async () => (await probe()).settled).toBe(abortAt === "pending" ? 1 : 2);
      const after = await probe();
      expect(after.documentId).toBe(documentId);
      expect(after.aborts).toBeGreaterThanOrEqual(1);
      expect(after.eligibilityRequests).toBe(0);
      expect(attempts).toEqual(abortAt === "pending" ? ["pending"] : ["pending", "stored"]);
      await expectUnchanged(page, before);
      console.log(
        JSON.stringify({
          gate: "anonymous-bootstrap-abort",
          abortAt,
          attempts,
          sameDocument: true,
          probe: after,
          storagePreserved: true,
        }),
      );
    } finally {
      release.resolve();
    }
  });
}
