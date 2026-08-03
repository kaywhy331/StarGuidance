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

test.describe.configure({ mode: "serial" });

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
  // Sign-in is the only unauthenticated flow; scan it in a clean context.
  const anonymous = await page.context().browser()?.newContext();
  if (anonymous) {
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.goto(`${String(test.info().project.use.baseURL)}/sign-in`);
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

  await page.goto("/onboarding");
  await expect(page.getByLabel("Full birth name")).toBeVisible({ timeout: 60_000 });
  await scan("onboarding");

  await page.getByLabel("Full birth name").fill("Axe Synthetic");
  await page.getByLabel("Date of birth").fill("1988-03-21");
  await page.getByRole("checkbox", { name: /I consent to private profile calculation/i }).check();
  await page.getByRole("button", { name: "Check profile capability" }).click();
  try {
    await expect(page).toHaveURL(/\/readings$/, { timeout: 60_000 });
  } catch (error) {
    // Say what the form reported rather than only which URL was expected.
    const alert = page.getByRole("alert").first();
    const message = (await alert.isVisible().catch(() => false))
      ? ((await alert.textContent().catch(() => "")) ?? "").trim()
      : "no visible error";
    // The message is identical for several unrelated faults; the API reports
    // which one, so ask it rather than leaving the next run to guess.
    let apiReason = "";
    try {
      apiReason = await page.evaluate(async () => {
        const response = await fetch("/api/profile", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            fullBirthName: "Diagnostic Synthetic",
            birthDate: "1990-01-15",
            consentVersion: "privacy-reflective-v1",
          }),
        });
        const body = (await response.json()) as { reason?: string };
        return `${response.status}${body.reason ? ` (${body.reason})` : ""}`;
      });
    } catch {
      apiReason = "unavailable";
    }
    record({
      section: "Accessibility",
      check: "Onboarding reached the reading selection",
      status: "fail",
      detail: `stopped at ${new URL(page.url()).pathname}: "${message}"; direct API attempt returned ${apiReason}`,
    });
    throw new Error(`Onboarding did not complete during the scan — ${message}`, { cause: error });
  }
  await scan("reading selection");

  await page.getByLabel("Your private question").fill("What deserves my attention now?");
  await page.getByRole("button", { name: "Begin the shuffle" }).click();
  await expect(page).toHaveURL(/\/session\/[a-f0-9-]+$/, { timeout: 60_000 });
  await scan("sanctuary reading");

  await page.getByRole("button", { name: "Finish shuffling" }).click();
  await page.getByRole("button", { name: "Skip cut" }).click();
  await page.getByRole("button", { name: "Reveal all" }).click();
  await expect(page.getByTestId("oracle-transcript")).toBeVisible({ timeout: 60_000 });
  await scan("revealed result");

  const details = page.getByRole("button", { name: /details/i }).first();
  if (await details.isVisible().catch(() => false)) {
    await details.click();
    await scan("details drawer");
  } else {
    findings.push({ flow: "details drawer", violations: [] });
  }

  await page.goto("/settings/privacy");
  await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 60_000 });
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
