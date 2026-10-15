import { randomBytes, randomUUID } from "node:crypto";
import { chromium, firefox, webkit, expect, test, type Page } from "@playwright/test";
import { POLICY_VERSIONS } from "../../src/lib/policies";

const KEYS = {
  receipt: "sg:guest-reading-receipt:v1",
  handoff: "sg:guest-reading-handoff:v1",
  pending: "sg:guest-reading:v2",
};
const password = "synthetic-private-password";
const expired = { error: "Your saved guest reading expired after 7 days.", expired: true };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

async function signup(page: Page, origin: string) {
  const email = `lifecycle-${randomUUID()}@example.test`;
  const response = await page.request.post(`${origin}/api/auth`, {
    headers: { origin },
    data: {
      action: "sign-up",
      email,
      password,
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
  expect(response.ok()).toBe(true);
  return email;
}

async function setup(page: Page, baseURL: string | undefined) {
  if (!baseURL || !["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname))
    throw new Error("Lifecycle fixtures require the local test server");
  const origin = new URL(baseURL).origin;
  expect(await (await page.request.get(`${origin}/api/health`)).json()).toMatchObject({
    appEnvironment: "test",
    runtimeAdapter: "local",
  });
  const headers = { origin, "x-starguidance-guest-device": randomUUID() };
  const prepared = await page.request.post(`${origin}/api/guest-readings`, {
    headers,
    data: {
      action: "prepare",
      question: "What deserves my attention today?",
      questionConfirmed: true,
      personalizationMode: "pure_tarot",
      termsAccepted: true,
      privacyAccepted: true,
      ageConfirmed: true,
    },
  });
  expect(prepared.ok()).toBe(true);
  const { ceremony } = await prepared.json();
  const finalized = await page.request.post(`${origin}/api/guest-readings`, {
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
  const email = await signup(page, origin);
  await page.goto(`${origin}/settings/privacy`);
  await page.evaluate(
    ({ keys, guest }) => {
      localStorage.setItem(keys.receipt, guest.receipt);
      localStorage.setItem(keys.handoff, guest.handoff);
      sessionStorage.setItem(
        keys.pending,
        JSON.stringify({
          kind: "receipt",
          receipt: guest.receipt,
          revealedIndexes: [0],
          resultUnlocked: true,
        }),
      );
    },
    { keys: KEYS, guest },
  );
  return { ...guest, origin, email };
}

async function storage(page: Page) {
  return page.evaluate(
    (keys) => ({
      receipt: localStorage.getItem(keys.receipt),
      handoff: localStorage.getItem(keys.handoff),
      pending: sessionStorage.getItem(keys.pending),
    }),
    KEYS,
  );
}

const save = (page: Page, origin: string, receipt: string) =>
  page.request.post(`${origin}/api/guest-readings/continue`, {
    headers: { origin },
    data: { action: "save", receipt },
  });

test("five overlapping first saves keep one owner's exact draw", async ({ page, baseURL }) => {
  const guest = await setup(page, baseURL);
  const replies = await Promise.all(
    Array.from({ length: 5 }, () => save(page, guest.origin, guest.receipt)),
  );
  expect(
    replies.map((reply) => reply.status()).every((status) => [200, 201].includes(status)),
  ).toBe(true);
  const bodies = await Promise.all(replies.map((reply) => reply.json()));
  const id = bodies[0].readingId as string;
  expect(bodies.every((body) => body.readingId === id)).toBe(true);
  const history = await (await page.request.get("/api/readings")).json();
  expect(history.readings.map((reading: { id: string }) => reading.id)).toEqual([id]);
  const saved = await (await page.request.get(`/api/readings/${id}`)).json();
  expect(
    saved.reading.draw.assignments.map(
      ({ cardId, orientation }: { cardId: string; orientation: string }) => ({
        cardId,
        orientation,
      }),
    ),
  ).toEqual(guest.reading.cards.map(({ cardId, orientation }) => ({ cardId, orientation })));
});

test("competing accounts cannot both own or read the saved history entry", async ({
  page,
  browser,
  baseURL,
}) => {
  const guest = await setup(page, baseURL);
  const otherContext = await browser.newContext({ baseURL: guest.origin });
  try {
    const other = await otherContext.newPage();
    await signup(other, guest.origin);
    const replies = await Promise.all([
      save(page, guest.origin, guest.receipt),
      save(other, guest.origin, guest.receipt),
    ]);
    expect(replies.map((reply) => reply.status()).sort()).toEqual([201, 409]);
    const winner = replies.findIndex((reply) => reply.status() === 201);
    const { readingId } = await replies[winner]!.json();
    const loser = winner === 0 ? other : page;
    expect((await loser.request.get(`/api/readings/${readingId}`)).status()).toBe(404);
    expect((await (await loser.request.get("/api/readings")).json()).readings).toEqual([]);
  } finally {
    await otherContext.close();
  }
});

test("a delayed save retry must not resurrect a deleted history entry", async ({
  page,
  baseURL,
}) => {
  const guest = await setup(page, baseURL);
  const first = await save(page, guest.origin, guest.receipt);
  expect(first.status()).toBe(201);
  const { readingId } = await first.json();
  const received = deferred();
  const release = deferred();
  await page.route("**/api/guest-readings/continue", async (route) => {
    received.resolve();
    await release.promise;
    await route.continue();
  });
  const pending = page.evaluate(async (receipt) => {
    const response = await fetch("/api/guest-readings/continue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "save", receipt }),
    });
    return { status: response.status, body: await response.json() };
  }, guest.receipt);
  try {
    await received.promise;
    expect(
      (
        await page.request.delete(`/api/readings/${readingId}`, {
          headers: { origin: guest.origin },
        })
      ).status(),
    ).toBe(200);
    expect((await page.request.get(`/api/readings/${readingId}`)).status()).toBe(404);
    release.resolve();
    const retry = await pending;
    const after = await page.request.get(`/api/readings/${readingId}`);
    // Keep the invariant as a normal assertion: a resurrection is a real failure.
    console.log(
      JSON.stringify({
        gate: "delete-versus-delayed-save",
        retryStatus: retry.status,
        statusAfterRetry: after.status(),
      }),
    );
    expect(after.status(), "a save initiated before deletion must not recreate the reading").toBe(
      404,
    );
  } finally {
    release.resolve();
    await pending;
  }
});

test("signed-in client unmount aborts pending recovery and preserves copies for retry", async ({
  page,
  baseURL,
}) => {
  const guest = await setup(page, baseURL);
  const before = await storage(page);
  await page.addInitScript(() => {
    const probe = { documentId: crypto.randomUUID(), requests: 0, aborts: 0, settled: 0 };
    (window as unknown as { continuityProbe: typeof probe }).continuityProbe = probe;
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      if (!String(args[0]).endsWith("/api/guest-readings/continue")) return original(...args);
      probe.requests += 1;
      args[1]?.signal?.addEventListener(
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
  await page.route("**/api/guest-readings/continue", async (route) => {
    received.resolve();
    await release.promise;
    try {
      await route.fulfill({ status: 410, json: expired });
    } catch {
      /* aborted */
    } finally {
      finished.resolve();
    }
  });
  const probe = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            continuityProbe: {
              documentId: string;
              requests: number;
              aborts: number;
              settled: number;
            };
          }
        ).continuityProbe,
    );
  try {
    await page.goto("/free-reading?continue=1");
    await received.promise;
    const documentId = (await probe()).documentId;
    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: "StarGuidance", exact: true })
      .click();
    await expect(page).toHaveURL(`${guest.origin}/`);
    release.resolve();
    await finished.promise;
    await expect.poll(async () => (await probe()).settled).toBe(1);
    expect(await probe()).toMatchObject({ documentId, requests: 1, aborts: 1 });
    expect(await storage(page)).toEqual(before);
    await page.unroute("**/api/guest-readings/continue");
    await page.goto("/free-reading?continue=1");
    await expect(page.getByTestId("guest-continuation-keepsake")).toHaveAttribute(
      "data-card-assignments",
      guest.reading.cards.map((card) => `${card.cardId}:${card.orientation}`).join(" "),
    );
  } finally {
    release.resolve();
  }
});

test("valid handoff fallback survives reload with an older pending receipt", async ({
  page,
  baseURL,
}) => {
  const guest = await setup(page, baseURL);
  const before = await storage(page);
  const attempts: string[] = [];
  await page.route("**/api/guest-readings/continue", async (route) => {
    const body = route.request().postDataJSON();
    attempts.push(body.action);
    if (body.action === "recover" && body.receipt === guest.receipt)
      return route.fulfill({ status: 410, json: expired });
    return route.continue();
  });
  await page.goto("/free-reading?continue=1");
  const cards = guest.reading.cards.map((card) => `${card.cardId}:${card.orientation}`).join(" ");
  await expect(page.getByTestId("guest-continuation-keepsake")).toHaveAttribute(
    "data-card-assignments",
    cards,
  );
  const recovered = await storage(page);
  expect(attempts).toEqual(["recover", "redeem"]);
  expect(recovered.pending).toBe(before.pending);
  expect(recovered.receipt).not.toBe(before.receipt);
  await page.reload();
  await expect(page.getByTestId("guest-continuation-keepsake")).toHaveAttribute(
    "data-card-assignments",
    cards,
  );
  expect(attempts).toEqual(["recover", "redeem", "recover"]);
  expect((await storage(page)).pending).toBe(before.pending);
});

test("fragment handoff opens the same reading in a different browser engine without shared storage", async ({
  page,
  browserName,
  baseURL,
}, testInfo) => {
  const guest = await setup(page, baseURL);
  const target =
    browserName === "chromium" ? firefox : browserName === "firefox" ? webkit : chromium;
  const destination = await target.launch();
  try {
    const context = await destination.newContext({ baseURL: guest.origin });
    const other = await context.newPage();
    const login = await other.request.post(`${guest.origin}/api/auth`, {
      headers: { origin: guest.origin },
      data: { action: "sign-in", email: guest.email, password },
    });
    expect(login.ok()).toBe(true);
    await other.goto(`${guest.origin}/settings/privacy`);
    expect(await storage(other)).toEqual({ receipt: null, handoff: null, pending: null });
    const requestUrls: string[] = [];
    other.on("request", (request) => requestUrls.push(request.url()));
    await other.goto(
      `${guest.origin}/free-reading?continue=1#handoff=${encodeURIComponent(guest.handoff)}`,
    );
    await expect(other).toHaveURL(`${guest.origin}/free-reading?continue=1`);
    await expect(other.getByTestId("guest-continuation-keepsake")).toHaveAttribute(
      "data-card-assignments",
      guest.reading.cards.map((card) => `${card.cardId}:${card.orientation}`).join(" "),
    );
    expect(
      requestUrls.every((url) => !url.includes(guest.handoff) && !url.includes("handoff=")),
    ).toBe(true);
    expect((await (await other.request.get("/api/readings")).json()).readings).toEqual([]);
    await other.getByRole("button", { name: "Save to my readings" }).click();
    await expect(other.getByTestId("guest-save-panel").getByRole("status")).toContainText(
      "Saved to your readings",
    );
    expect((await (await page.request.get("/api/readings")).json()).readings).toHaveLength(1);
    console.log(
      JSON.stringify({
        gate: "cross-engine-handoff",
        source: testInfo.project.name,
        destination: target.name(),
        destinationVersion: destination.version(),
        sameCards: true,
        sharedStorage: false,
      }),
    );
  } finally {
    await destination.close();
  }
});
