import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "node:crypto";

import { getInterpretationQueueStats } from "@starguidance/database";
import { INTERPRETATION_WORKER_TOKEN_CONTEXT } from "@starguidance/contracts";

import { runInterpretationJobs } from "@/lib/interpretation-worker";
import { getSystemDatabaseClient } from "@/lib/runtime";
import { isWeakSharedSecret } from "@/lib/shared-secret";

/**
 * Bound to no browser session — this is the only thing the Netlify-scheduled
 * trigger (netlify/functions/process-interpretation-jobs.mts) ever calls. It
 * exists because Netlify's zip-it-and-ship-it bundler cannot resolve
 * `postgres` at runtime for a standalone Netlify Function
 * (netlify/zip-it-and-ship-it#869, confirmed here across three bundler
 * configurations); keeping the actual claim/AI-call/write work here, behind
 * the already-proven Next.js/Postgres path, sidesteps that bug rather than
 * fighting it. The scheduled function is a trivial, dependency-free fetch.
 */
const BATCH_LIMIT = 10;

function expectedToken(secret: string): string {
  return createHmac("sha256", secret)
    .update(INTERPRETATION_WORKER_TOKEN_CONTEXT)
    .digest("base64url");
}

// Same shape as /api/health's readinessAuthorized: the raw secret is never
// sent over the wire, only an HMAC derived from it, timing-safe compared.
function authorized(request: Request): boolean {
  const secret = process.env.INTERPRETATION_WORKER_SECRET;
  if (isWeakSharedSecret(secret)) return false;
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const received = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(expectedToken(secret!));
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request: Request) {
  if (!authorized(request))
    return NextResponse.json(
      { status: "unauthorized" },
      { status: 401, headers: { "cache-control": "no-store", "www-authenticate": "Bearer" } },
    );
  try {
    const summary = await runInterpretationJobs(BATCH_LIMIT);
    // Counted on the same connection role the worker's cross-user claim path
    // uses (interpretation_jobs_system, migration 0008) — the app role's own
    // policy is subject-bound and a subject-less transaction would count
    // nothing. Reported here so the scheduled trigger
    // (netlify/functions/process-interpretation-jobs.mts) can alert when the
    // backlog is growing across cycles rather than draining.
    const stats = await getInterpretationQueueStats(getSystemDatabaseClient());
    return NextResponse.json(
      {
        status: "ok",
        ...summary,
        queueDepth: stats.depth,
        oldestPendingAgeSeconds: stats.oldestPendingAgeSeconds,
      },
      { status: 200, headers: { "cache-control": "no-store" } },
    );
  } catch {
    // Claimed jobs' own failures are already recorded per-job inside
    // runInterpretationJobs; reaching here means claiming itself failed
    // (e.g. a database outage). Report it — the caller (the scheduled
    // function) logs a non-2xx rather than a silently "successful" no-op.
    return NextResponse.json(
      { status: "error" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
