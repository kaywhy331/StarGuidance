// Throwaway smoke test (StarGuidance Workstream B, Step 0): proves Netlify's
// function bundler resolves a pnpm-workspace package (@starguidance/database)
// from netlify/functions/ before the real interpretation-job worker is built
// on top of the same import path. Safe to delete once a deploy confirms this
// — see docs/KNOWN-GAPS.md's background-generation entry.
import { APPLICATION_DATABASE_ROLE } from "@starguidance/database";

async function handler(): Promise<Response> {
  return Response.json({ ok: true, applicationDatabaseRole: APPLICATION_DATABASE_ROLE });
}

export default handler;
