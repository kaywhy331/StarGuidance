// Durability backstop for background interpretation and paid-report generation (StarGuidance
// Workstream B — see docs/KNOWN-GAPS.md). Deliberately zero workspace/npm
// dependencies beyond @netlify/functions' types: Netlify's zip-it-and-ship-it
// bundler cannot resolve `postgres` at runtime for a standalone Netlify
// Function (netlify/zip-it-and-ship-it#869, confirmed here across three
// bundler configurations before this file existed). The actual
// claim/AI-call/write work lives behind the already-proven Next.js/Postgres
// path at POST /api/internal/interpretation-jobs; this function's only job is
// to fetch that route on a schedule with a bearer token, using nothing but
// Node's built-in `crypto` (never an npm package).
import type { Config } from "@netlify/functions";
import { createHmac } from "node:crypto";

// Must match @starguidance/contracts' INTERPRETATION_WORKER_TOKEN_CONTEXT
// exactly — this derives the same HMAC so the raw INTERPRETATION_WORKER_SECRET
// is never sent over the wire, only a token derived from it. Kept as this
// file's own literal (rather than importing the package) so the deployed
// bundle stays dependency-free; exported so a sibling test can assert the two
// copies haven't drifted apart.
export const TOKEN_CONTEXT = "starguidance-interpretation-worker-v1";

// The drain route claims up to 10 jobs per invocation (apps/web's
// BATCH_LIMIT) and this function fires every minute, so a depth still above
// this threshold means the backlog is growing across multiple cycles, not
// merely mid-cycle — worth a distinct, greppable alert line rather than
// waiting for a user-visible symptom.
const QUEUE_DEPTH_ALERT_THRESHOLD = 20;

/**
 * Parses the drain route's already-fetched response body for both queue
 * depths and alerts when either is over threshold. Never throws: a malformed or
 * unexpected body is itself worth a log line, but must never turn a
 * successful trigger into a reported failure.
 */
async function alertOnHighQueueDepth(response: Response): Promise<void> {
  try {
    const body: unknown = await response.json();
    const object = body && typeof body === "object" ? body : undefined;
    for (const [label, field] of [
      ["interpretation", "queueDepth"],
      ["report", "reportQueueDepth"],
    ] as const) {
      const queueDepth = object && field in object ? (object as Record<string, unknown>)[field] : 0;
      if (typeof queueDepth === "number" && queueDepth > QUEUE_DEPTH_ALERT_THRESHOLD)
        console.error(
          `process-interpretation-jobs: ${label} queue depth ${queueDepth} exceeds alert threshold ${QUEUE_DEPTH_ALERT_THRESHOLD}`,
        );
    }
  } catch (error) {
    console.error("process-interpretation-jobs: could not parse trigger response body", error);
  }
}

async function handler(): Promise<Response> {
  const target = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.INTERPRETATION_WORKER_SECRET;
  if (!target || !secret) {
    console.error(
      "process-interpretation-jobs: missing NEXT_PUBLIC_APP_URL or INTERPRETATION_WORKER_SECRET",
    );
    return new Response(null, { status: 500 });
  }
  const token = createHmac("sha256", secret).update(TOKEN_CONTEXT).digest("base64url");
  try {
    const response = await fetch(new URL("/api/internal/interpretation-jobs", target), {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      console.error(`process-interpretation-jobs: trigger responded ${response.status}`);
      return new Response(null, { status: 502 });
    }
    await alertOnHighQueueDepth(response);
    return new Response(null, { status: 202 });
  } catch (error) {
    console.error("process-interpretation-jobs: trigger request failed", error);
    return new Response(null, { status: 502 });
  }
}

export default handler;

export const config: Config = { schedule: "*/1 * * * *" };
