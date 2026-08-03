import { completeStage, record } from "@starguidance/database/staging-evidence";

/**
 * Playwright global setup for the staging verification suite.
 *
 * Netlify begins building when the branch is pushed, so the deploy preview can
 * still be serving an earlier commit when this workflow starts. Verifying that
 * deployment would prove nothing about the commit under test, and it would do so
 * silently — every later assertion would pass against the wrong code.
 *
 * This therefore runs before any spec: it waits for the preview to report the
 * expected build and refuses to continue if it never does. Only the commit is
 * read, which is public information about a public repository, and only its
 * short form is recorded.
 */
const POLL_INTERVAL_MS = 20_000;
const MAX_WAIT_MS = 600_000;

interface HealthBody {
  deployedCommit?: string | null;
}

async function readDeployedCommit(baseUrl: string): Promise<string | undefined> {
  try {
    const response = await fetch(`${baseUrl}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
    const body = (await response.json()) as HealthBody;
    return body.deployedCommit?.trim() || undefined;
  } catch {
    // A build in progress can return a gateway error; keep waiting.
    return undefined;
  }
}

export default async function waitForPreview(): Promise<void> {
  const baseUrl = process.env.STAGING_BASE_URL?.trim().replace(/\/$/, "");
  if (!baseUrl) throw new Error("STAGING_BASE_URL must name the deploy preview to verify");

  const expected = process.env.GITHUB_SHA?.trim();
  if (!expected) {
    // Outside the workflow there is no commit to compare against.
    record({
      section: "Netlify runtime",
      check: "Deploy preview build provenance",
      status: "limited",
      detail: "no commit under test was provided, so preview provenance was not verified",
    });
    return;
  }

  const deadline = Date.now() + MAX_WAIT_MS;
  let deployed = await readDeployedCommit(baseUrl);
  while (deployed !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    deployed = await readDeployedCommit(baseUrl);
  }

  const matches = deployed === expected;
  record({
    section: "Netlify runtime",
    check: "Deploy preview was built from the commit under test",
    status: matches ? "pass" : "fail",
    detail: matches
      ? `the preview reports build commit ${expected.slice(0, 7)}`
      : `the preview reports build commit ${(deployed ?? "none").slice(0, 7)} rather than the ` +
        `commit under test ${expected.slice(0, 7)}, after waiting ten minutes for the build`,
  });
  if (matches) completeStage("preview-provenance");
  if (!matches)
    throw new Error(
      "The deploy preview is not serving the commit under test; verifying it would prove nothing.",
    );
}
