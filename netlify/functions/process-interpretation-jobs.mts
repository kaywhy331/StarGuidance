// Durability backstop for background interpretation generation (StarGuidance
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

// Must match apps/web/src/app/api/internal/interpretation-jobs/route.ts's
// TOKEN_CONTEXT exactly — this derives the same HMAC so the raw
// INTERPRETATION_WORKER_SECRET is never sent over the wire, only a token
// derived from it.
const TOKEN_CONTEXT = "starguidance-interpretation-worker-v1";

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
    if (!response.ok)
      console.error(`process-interpretation-jobs: trigger responded ${response.status}`);
    return new Response(null, { status: response.ok ? 202 : 502 });
  } catch (error) {
    console.error("process-interpretation-jobs: trigger request failed", error);
    return new Response(null, { status: 502 });
  }
}

export default handler;

export const config: Config = { schedule: "*/1 * * * *" };
