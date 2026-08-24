import AxeBuilder from "@axe-core/playwright";
import { completeStage, record } from "@starguidance/database/staging-evidence";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  authenticate,
  createSyntheticIdentity,
  deleteSyntheticIdentity,
  type SyntheticIdentity,
} from "./synthetic-auth";

/**
 * Automated WCAG scanning of the critical deployed flows.
 *
 * Automated rules cover only a subset of WCAG 2.2 AA. This is not a human
 * accessibility certification and must never be reported as one. The existing
 * keyboard, reduced-motion, aria-live, card-label, mobile, and scroll-interruption
 * assertions in tests/e2e remain the behavioural coverage and are unchanged.
 */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const NAVIGATION_OPTIONS = { waitUntil: "commit" as const, timeout: 30_000 };
const NAVIGATION_ATTEMPTS = 3;
const CLIENT_TRANSITION_TIMEOUT_MS = 15_000;

interface Violation {
  readonly id: string;
  readonly impact: string;
  readonly nodes: number;
  /**
   * CSS selectors for the offending elements. Structural only — never element
   * text — so a violation can be located in the source without carrying a
   * question, a card, or anything a person typed into published evidence.
   */
  readonly where: string;
}

let identity: SyntheticIdentity;
let context: BrowserContext;
let page: Page;
const findings: { flow: string; violations: Violation[] }[] = [];
const reflowFindings: { flow: string; overflow: number; clipped: string[] }[] = [];

test.describe.configure({ mode: "serial" });

function pagePath(targetPage: Page): string {
  try {
    return new URL(targetPage.url()).pathname;
  } catch {
    return "";
  }
}

async function navigateForScan(
  targetPage: Page,
  target: string,
  ready: () => Promise<void>,
): Promise<void> {
  const expectedPath = new URL(target, String(test.info().project.use.baseURL)).pathname;
  let lastError: unknown;

  for (let attempt = 1; attempt <= NAVIGATION_ATTEMPTS; attempt += 1) {
    let reachedTarget = false;
    try {
      await targetPage.goto(target, NAVIGATION_OPTIONS);
      reachedTarget = true;
    } catch (error) {
      lastError = error;
      reachedTarget = pagePath(targetPage) === expectedPath;
    }

    if (reachedTarget) {
      try {
        // A server-rendered heading can become visible after the document commits
        // but before the linked Tailwind stylesheet has loaded. Axe would then
        // measure unstyled controls and report transient target-size failures.
        // The load event is the browser-owned boundary that guarantees linked
        // stylesheets have settled without coupling the scan to expected styles.
        await targetPage.waitForLoadState("load", { timeout: NAVIGATION_OPTIONS.timeout });
        await ready();
        return;
      } catch (error) {
        lastError = error;
      }
    }

    if (attempt < NAVIGATION_ATTEMPTS) await targetPage.waitForTimeout(attempt * 500);
  }

  throw lastError ?? new Error(`navigation to ${expectedPath} did not become scan-ready`);
}

/**
 * Counts frames on the page and separates ours from the preview host's.
 *
 * A deploy preview carries an injected toolbar in an iframe that this project
 * neither ships nor can repair, and which does not exist in production.
 * Scanning it reports critical failures against someone else's markup. The
 * application embeds no frames of its own, so any same-origin frame would be
 * ours and must never be excluded silently — hence the count is recorded and
 * asserted rather than assumed.
 */
async function frameOrigins(): Promise<{ injected: number; sameOrigin: number }> {
  const appOrigin = new URL(String(test.info().project.use.baseURL)).origin;
  return page.evaluate((origin) => {
    const frames = [...document.querySelectorAll("iframe")];
    let sameOrigin = 0;
    for (const frame of frames) {
      const source = frame.getAttribute("src") ?? "";
      if (!source || source.startsWith("/") || source.startsWith(origin)) sameOrigin += 1;
    }
    return { injected: frames.length - sameOrigin, sameOrigin };
  }, appOrigin);
}

async function scan(flow: string): Promise<void> {
  // Exclude the preview host's injected frames, never our own.
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude("iframe").analyze();
  findings.push({
    flow,
    violations: results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? "unknown",
      nodes: violation.nodes.length,
      where: violation.nodes
        .slice(0, 3)
        .map((node) => node.target.flat().join(" "))
        .join(" | "),
    })),
  });
}

async function checkReflow(flow: string): Promise<void> {
  const evidence = await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
    const viewportWidth = document.documentElement.clientWidth;
    const overflow =
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewportWidth;
    const clipped = [
      ...document.querySelectorAll<HTMLElement>("a,button,input,textarea,select,[tabindex]"),
    ]
      .filter(
        (element) => !element.classList.contains("skip-link") && element.offsetParent !== null,
      )
      .filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && (bounds.left < -1 || bounds.right > viewportWidth + 1);
      })
      .slice(0, 10)
      .map((element) => `${element.tagName.toLowerCase()}#${element.id || "unidentified"}`);
    return { overflow, clipped };
  });
  reflowFindings.push({ flow, ...evidence });
}

test.beforeAll(async ({ browser }, testInfo) => {
  const baseUrl = String(testInfo.project.use.baseURL);
  identity = await createSyntheticIdentity("accessibility subject");
  context = await browser.newContext({ baseURL: baseUrl });
  await authenticate(context, identity, baseUrl);
  page = await context.newPage();
});

test.afterAll(async () => {
  await context?.close().catch(() => undefined);
  if (identity) await deleteSyntheticIdentity(identity);
});

test("critical deployed flows pass automated WCAG rules", async () => {
  test.setTimeout(300_000);

  // Sign-in is the only unauthenticated flow; scan it in a clean context.
  const anonymous = await page.context().browser()?.newContext();
  if (anonymous) {
    const anonymousPage = await anonymous.newPage();
    await navigateForScan(anonymousPage, `${String(test.info().project.use.baseURL)}/sign-in`, () =>
      expect(anonymousPage.getByRole("heading").first()).toBeVisible({ timeout: 15_000 }),
    );
    const results = await new AxeBuilder({ page: anonymousPage })
      .withTags(WCAG_TAGS)
      .exclude("iframe")
      .analyze();
    findings.push({
      flow: "sign-in",
      violations: results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? "unknown",
        nodes: violation.nodes.length,
        where: violation.nodes
          .slice(0, 3)
          .map((node) => node.target.flat().join(" "))
          .join(" | "),
      })),
    });
    await anonymous.close();
  }

  await navigateForScan(page, "/onboarding", () =>
    expect(page.getByLabel("Full birth name")).toBeVisible({ timeout: 15_000 }),
  );
  await scan("onboarding");

  await page.getByLabel("Full birth name").fill("Axe Synthetic");
  await page.getByLabel("Date of birth").fill("1988-03-21");
  await page
    .getByRole("checkbox", { name: /I consent to the private use of my birth details/i })
    .check();
  const profileResponsePromise = page
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/profile" &&
        response.request().method() === "POST",
      { timeout: 60_000 },
    )
    .catch(() => undefined);
  await page.getByRole("button", { name: "Save and continue" }).click();
  const profileResponse = await profileResponsePromise;
  try {
    await expect(page).toHaveURL(/\/readings$/, { timeout: CLIENT_TRANSITION_TIMEOUT_MS });
  } catch (error) {
    // Say what the form reported rather than only which URL was expected.
    const alert = page.getByRole("alert").first();
    const message = (await alert.isVisible().catch(() => false))
      ? ((await alert.textContent().catch(() => "")) ?? "").trim()
      : "no visible error";
    if (!profileResponse?.ok()) {
      record({
        section: "Accessibility",
        check: "Onboarding reached the reading selection",
        status: "fail",
        detail: `stopped at ${pagePath(page)}: "${message}"; form POST returned ${
          profileResponse?.status() ?? "no response"
        }`,
      });
      throw new Error(`Onboarding did not complete during the scan — ${message}`, {
        cause: error,
      });
    }
    record({
      section: "Accessibility",
      check: "Deploy-preview client transition after onboarding",
      status: "limited",
      detail:
        `the form POST returned ${profileResponse.status()}, but the preview-host transition ` +
        "did not settle; the scanner resumed through a directly committed application route",
    });
    await navigateForScan(page, "/readings", () =>
      expect(page.getByLabel("Your private question")).toBeVisible({
        timeout: 15_000,
      }),
    );
  }
  await expect(page.getByLabel("Your private question")).toBeVisible({ timeout: 15_000 });
  await scan("reading question");
  await page.getByLabel("Your private question").fill("What deserves my attention now?");
  await page.getByRole("button", { name: "Review my question" }).click();
  await expect(page.getByRole("button", { name: "Confirm this question" })).toBeVisible();
  await scan("question confirmation");
  await page.getByRole("button", { name: "Confirm this question" }).click();
  await expect(
    page.getByRole("heading", { name: "Select a spread for your confirmed question" }),
  ).toBeVisible();
  await scan("reading selection");
  await page
    .getByRole("button", { name: "Confirm Three Cards — Situation, Challenge, Direction" })
    .click();
  await expect(page.getByRole("button", { name: "Begin the shuffle" })).toBeVisible();
  await scan("reading focus");
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  await expect(page.getByRole("button", { name: "Finish shuffling" })).toBeVisible();
  await scan("reading shuffle");
  await page.getByRole("button", { name: "Finish shuffling" }).click();
  await expect(page.getByRole("button", { name: /^No cut/ })).toBeVisible();
  await scan("optional deck cut");
  const readingResponsePromise = page
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/readings" &&
        response.request().method() === "POST" &&
        response.request().postData()?.includes('"action":"finalize"') === true,
      { timeout: 60_000 },
    )
    .catch(() => undefined);
  await page.getByRole("button", { name: /^No cut/ }).click();
  const readingResponse = await readingResponsePromise;
  try {
    await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, {
      timeout: CLIENT_TRANSITION_TIMEOUT_MS,
    });
  } catch (error) {
    const body = readingResponse?.ok()
      ? ((await readingResponse.json().catch(() => undefined)) as
          { readingId?: string } | undefined)
      : undefined;
    if (!body?.readingId) throw error;
    record({
      section: "Accessibility",
      check: "Deploy-preview client transition after reading creation",
      status: "limited",
      detail:
        `the reading POST returned ${readingResponse?.status()}, but the preview-host transition ` +
        "did not settle; the scanner resumed at the same locked reading",
    });
    await navigateForScan(page, `/session/${body.readingId}`, () =>
      expect(page.locator("main")).toBeVisible({ timeout: 15_000 }),
    );
  }
  await scan("sanctuary reading");

  // Reveal remains an intentional action (UX-006). Shorten decorative timing
  // and drive the same centered ready/next sequence through accessible controls.
  const motionControl = page.getByRole("button", { name: /^Reduced motion/ });
  if ((await motionControl.getAttribute("aria-pressed")) !== "true")
    await motionControl.dispatchEvent("click");
  await expect(motionControl).toHaveAttribute("aria-pressed", "true");
  const sanctuary = page.getByTestId("mystic-sanctuary-scene");
  await expect(sanctuary).toHaveAttribute("data-reduced-motion", "true");
  // Reduced motion advances the deal without exposing the transient Gather now
  // control. The ritual phase is the stable boundary for an actionable spread.
  await expect(sanctuary).toHaveAttribute("data-ritual-phase", "awaitingReveal", {
    timeout: 20_000,
  });
  await expect(page.getByTestId("question-reflection")).toBeVisible({ timeout: 12_000 });
  await page.getByRole("button", { name: /^(I’m ready|Continue revealing)$/ }).click();
  for (let index = 0; index < 10; index += 1) {
    await page
      .getByRole("button", { name: /^Reveal card \d+, face down$/ })
      .first()
      .click();
    const action = page.locator(".guided-next-action");
    await expect(action).toBeVisible();
    const finalCard = (await action.textContent())?.includes("Open the complete reading") === true;
    await action.click();
    if (finalCard) break;
  }

  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 60_000 });
  await scan("revealed result");
  await expect(page.getByRole("button", { name: "Next reading passage" })).toBeEnabled();
  await page.getByRole("button", { name: "Next reading passage" }).click();
  await scan("card interpretation section");
  const journey = page.getByTestId("reading-journey");
  await expect(journey).toHaveAttribute("data-state", "complete", { timeout: 30_000 });
  const passageCount = Number(await journey.getAttribute("data-loaded-section-count"));
  expect(passageCount).toBeGreaterThanOrEqual(3);
  await expect(page.getByTestId("reading-complete-story")).toBeVisible();
  const guidedMode = page.getByRole("button", { name: "Guided" });
  await guidedMode.focus();
  await expect(guidedMode).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(journey).toHaveAttribute("data-reading-mode", "guided");
  const transcript = page.getByTestId("oracle-transcript");
  await transcript.focus();
  await expect(transcript).toBeFocused();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "Next reading passage" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Previous reading passage" })).toBeEnabled();
  await expect(page.getByText(`${passageCount} of ${passageCount}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Starlit Reflection" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Before you leave the cards" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Ask the same cards/ })).toBeEnabled();
  await page.getByRole("button", { name: /Ask the same cards/ }).click();
  await expect(page.getByLabel("Keep the same cards and ask what they add")).toBeEnabled();
  await scan("final reflection and follow-up entry point");

  await page.setViewportSize({ width: 320, height: 640 });
  await checkReflow("completed reading at 320px and 200% text");

  await navigateForScan(page, "/settings/privacy", () =>
    expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 }),
  );
  await checkReflow("privacy controls at 320px and 200% text");
  await scan("privacy and account");

  const blocking = findings.flatMap(({ flow, violations }) =>
    violations
      .filter(({ impact }) => impact === "critical" || impact === "serious")
      .map((violation) => ({ flow, ...violation })),
  );
  const moderate = findings.flatMap(({ violations }) =>
    violations.filter(({ impact }) => impact !== "critical" && impact !== "serious"),
  );

  for (const { flow, violations } of findings)
    record({
      section: "Accessibility",
      check: `Automated WCAG scan — ${flow}`,
      status: violations.some(({ impact }) => impact === "critical" || impact === "serious")
        ? "fail"
        : "pass",
      detail:
        violations.length === 0
          ? "no violations reported by axe-core"
          : violations
              .map(
                ({ id, impact, nodes, where }) =>
                  `${id} (${impact}, ${nodes} node(s)) at ${where || "an unreported selector"}`,
              )
              .join("; "),
    });

  const frames = await frameOrigins();
  record({
    section: "Accessibility",
    check: "Frames excluded from the scan belong to the preview host",
    status: frames.sameOrigin === 0 ? "pass" : "fail",
    detail:
      frames.sameOrigin === 0
        ? `${frames.injected} frame(s) injected by the deploy-preview host were excluded; ` +
          "the application embeds none of its own, and production serves none of theirs"
        : `${frames.sameOrigin} frame(s) belong to the application and must not be excluded`,
  });
  expect(frames.sameOrigin, "the application must not embed frames the scan would skip").toBe(0);

  for (const finding of reflowFindings) {
    const passed = finding.overflow <= 1 && finding.clipped.length === 0;
    record({
      section: "Accessibility",
      check: `Text resize and reflow — ${finding.flow}`,
      status: passed ? "pass" : "fail",
      detail: passed
        ? "no horizontal document overflow or clipped interactive control"
        : `overflow ${finding.overflow}px; clipped ${finding.clipped.join(", ") || "none"}`,
    });
    expect(finding.overflow, `${finding.flow} must not scroll horizontally`).toBeLessThanOrEqual(1);
    expect(finding.clipped, `${finding.flow} controls must remain in the viewport`).toEqual([]);
  }

  record({
    section: "Accessibility",
    check: "Scan scope",
    status: "limited",
    detail:
      `${findings.length} flows scanned against ${WCAG_TAGS.join("/")}; ` +
      `${blocking.length} critical/serious and ${moderate.length} lesser violation(s). ` +
      "Frames injected by the deploy-preview host are excluded: they are not shipped by this " +
      "project, cannot be repaired here, and are absent in production. " +
      "Automated rules are not a human WCAG 2.2 AA certification.",
  });

  expect(
    blocking,
    `critical or serious accessibility violations: ${blocking
      .map(({ flow, id }) => `${flow}:${id}`)
      .join(", ")}`,
  ).toEqual([]);
  completeStage("accessibility");
});
