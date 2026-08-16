import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Enforces the single provisioning boundary.
 *
 * Since migration 0002 removed the auth.users synchronisation trigger, nothing
 * creates a `public.users` row except `repositories.users.ensure()`, which
 * `requireUser()` calls after validating the Supabase subject. Every table that
 * carries a foreign key onto `public.users` is therefore unreachable until that
 * boundary has run, and a route that reads or writes user-owned data without it
 * would fail with a foreign key violation on a fresh identity.
 *
 * This test reads the route sources rather than mocking them, so a new route
 * that forgets the boundary fails here instead of in staging.
 */
const appDir = join(dirname(fileURLToPath(import.meta.url)), "..", "app");

/**
 * Routes that legitimately never touch a user-owned repository. Each entry
 * states why; anything not listed must go through requireUser().
 */
const BOUNDARY_EXEMPT: Readonly<Record<string, string>> = {
  "api/auth/route.ts":
    "starts and ends a Supabase Auth session; it holds no repository and creates no application row",
  "api/health/route.ts":
    "reports configuration names and booleans only, and reads no user-owned table",
  "api/stripe/webhook/route.ts":
    "is an unauthenticated provider callback; ownership is resolved from the durable order row, " +
    "which an authenticated request created after requireUser() had already provisioned the user",
  "api/internal/interpretation-jobs/route.ts":
    "is a bearer-secret service trigger with no user session of its own; each claimed job's " +
    "user_id was already provisioned by the requireUser() call in POST /api/readings that " +
    "enqueued it",
  "auth/callback/route.ts":
    "exchanges signup or recovery codes for a session and redirects; it holds no repository",
  "art/tarot/v2/[asset]/route.ts": "serves versioned public artwork and reads no user-owned table",
};

function routeFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...routeFiles(full));
      continue;
    }
    if (entry === "route.ts" || entry === "route.tsx") found.push(full);
  }
  return found;
}

const routes = routeFiles(appDir).map((path) => ({
  key: relative(appDir, path).split("\\").join("/"),
  source: readFileSync(path, "utf8"),
}));

describe("authenticated route provisioning boundary", () => {
  it("finds the routes it is meant to audit", () => {
    expect(routes.length).toBeGreaterThan(5);
  });

  it("passes every non-exempt route through requireUser()", () => {
    for (const { key, source } of routes) {
      if (key in BOUNDARY_EXEMPT) continue;
      expect(source, `${key} must import the provisioning boundary`).toMatch(
        /import\s*\{[^}]*requireUser[^}]*\}\s*from\s*"@\/lib\/auth"/,
      );
      expect(source, `${key} must await requireUser() before using a repository`).toMatch(
        /await\s+requireUser\(\)/,
      );
    }
  });

  it("keeps every exempt route free of user-scoped repository access", () => {
    for (const [key, reason] of Object.entries(BOUNDARY_EXEMPT)) {
      const route = routes.find((candidate) => candidate.key === key);
      expect(route, `${key} is listed as exempt but no longer exists`).toBeDefined();
      expect(route?.source, `${key} is exempt because it ${reason}`).not.toMatch(
        /getRepositoriesForUser|persistenceFor/,
      );
    }
  });

  it("reaches user-scoped repositories only after the boundary", () => {
    for (const { key, source } of routes) {
      if (!/getRepositoriesForUser|persistenceFor/.test(source)) continue;
      const boundary = source.search(/await\s+requireUser\(\)/);
      const firstUse = source.search(/getRepositoriesForUser\(|persistenceFor\(/);
      expect(
        boundary,
        `${key} uses a user-scoped repository without requireUser()`,
      ).toBeGreaterThan(-1);
      expect(
        boundary,
        `${key} must call requireUser() before its first repository use`,
      ).toBeLessThan(firstUse);
    }
  });

  it("keeps requireUser() the only caller of users.ensure()", () => {
    const libDir = dirname(fileURLToPath(import.meta.url));
    const sources = readdirSync(libDir)
      .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => ({ name, source: readFileSync(join(libDir, name), "utf8") }));
    const callers = sources.filter(({ source }) => /users\.ensure\(/.test(source));
    expect(
      callers.map(({ name }) => name),
      "provisioning must happen in exactly one place",
    ).toEqual(["auth.ts"]);
  });
});
