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

/**
 * Wakes the hosted profile engine before any spec runs.
 *
 * The staging instance suspends when idle and can take far longer to answer its
 * first request than the application's deliberate eight-second client timeout.
 * Onboarding then fails with "the engine could not complete the calculation",
 * which is correct behaviour for an unavailable dependency but says nothing
 * about the application, and it lands on whichever spec happens to run first.
 */
async function wakeProfileEngine(): Promise<void> {
  const base = process.env.PROFILE_ENGINE_URL?.trim().replace(/\/+$/, "");
  if (!base) {
    record({
      section: "Profile engine",
      check: "Instance warmed before verification",
      status: "skipped",
      detail: "PROFILE_ENGINE_URL was not provided to this step",
    });
    return;
  }

  const deadline = Date.now() + 180_000;
  let attempts = 0;
  let status = 0;
  while (Date.now() < deadline) {
    attempts += 1;
    try {
      const response = await fetch(`${base}/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
      });
      status = response.status;
      if (status === 200) break;
    } catch {
      status = 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  // Waking the container is not the same as warming the path the application
  // uses. `/health` is trivial, while the first computation loads the modules
  // and data it needs, and that can exceed the application's deliberate
  // eight-second client timeout — so the first onboarding of the run fails with
  // "the engine could not complete the calculation" on an engine that is up.
  let computeStatus = 0;
  let computeMs = 0;
  const secret = process.env.PROFILE_ENGINE_SHARED_SECRET?.trim();
  if (status === 200 && secret) {
    const started = Date.now();
    try {
      const response = await fetch(`${base}/v1/profile/compute`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${secret}` },
        body: JSON.stringify({ full_birth_name: "Warm Up", birth_date: "2000-01-01" }),
        signal: AbortSignal.timeout(120_000),
      });
      computeStatus = response.status;
      await response.arrayBuffer();
    } catch {
      computeStatus = 0;
    }
    computeMs = Date.now() - started;
  }

  record({
    section: "Profile engine",
    check: "Instance warmed before verification",
    status: status === 200 && computeStatus === 200 ? "pass" : status === 200 ? "limited" : "fail",
    detail:
      status !== 200
        ? `not answering 200 after ${attempts} request(s) over three minutes (last status ${status})`
        : computeStatus === 200
          ? `awake after ${attempts} health request(s); first computation took ${computeMs}ms, ` +
            "so no spec pays the initialisation cost"
          : `health is 200 but the warm-up computation returned ${computeStatus}; the first ` +
            "onboarding of this run may exceed the application's client timeout",
  });
}

export default async function waitForPreview(): Promise<void> {
  await wakeProfileEngine();

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
