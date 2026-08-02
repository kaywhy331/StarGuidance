import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Guards the migration history itself.
 *
 * Applied migrations are immutable: editing 0000 or 0001 would silently diverge
 * every database that already ran them, because Drizzle records only a hash of
 * the file it applied and never re-applies it. The digests below therefore pin
 * the applied history, and the trigger assertions make sure no future migration
 * quietly reintroduces the auth.users synchronisation trigger that migration
 * 0002 removed.
 */
const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

interface JournalEntry {
  idx: number;
  tag: string;
}

function read(tag: string): string {
  return readFileSync(join(migrationsDir, `${tag}.sql`), "utf8");
}

function digest(tag: string): string {
  return createHash("sha256").update(read(tag), "utf8").digest("hex");
}

/**
 * Strips SQL comments so the escalation scan reads executable statements only.
 * Migration 0002's header names the constructs it deliberately avoids, and that
 * prose must not be mistaken for the constructs themselves.
 */
function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

function executableSql(tag: string): string {
  return stripComments(read(tag));
}

const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8")) as {
  entries: JournalEntry[];
};

/**
 * Pinned digests of the migrations that have already been applied to the
 * staging database. A failure here means an applied migration was edited, which
 * is never a valid correction — add a new migration instead.
 */
const IMMUTABLE_DIGESTS: Readonly<Record<string, string>> = {
  "0000_busy_centennial": "fea39ca2ff2c3ccbf425adeaea261de6c9a05eeed7cf16665516da03630871cb",
  "0001_supabase_staging": "c3d16aaa2337cde908ec42da0c73ef3287d3cb3cf83c78822d64972cca678727",
  "0002_remove_auth_user_sync_trigger":
    "f5148ce8cdaaacaede22250f916b0fd9c2c18e116da147adea6398d160452f32",
};

describe("migration history", () => {
  it("keeps every applied migration byte-identical", () => {
    for (const [tag, expected] of Object.entries(IMMUTABLE_DIGESTS)) {
      expect(digest(tag), `${tag}.sql was edited after it was applied`).toBe(expected);
    }
  });

  it("orders the corrective migration after the migration that created the trigger", () => {
    const tags = journal.entries.sort((a, b) => a.idx - b.idx).map(({ tag }) => tag);
    expect(tags).toEqual([
      "0000_busy_centennial",
      "0001_supabase_staging",
      "0002_remove_auth_user_sync_trigger",
    ]);
  });

  it("never recreates the auth.users synchronisation trigger after 0002", () => {
    const files = readdirSync(migrationsDir)
      .filter((name) => name.endsWith(".sql"))
      .sort();
    const correctiveIndex = files.indexOf("0002_remove_auth_user_sync_trigger.sql");
    expect(correctiveIndex, "the corrective migration must exist").toBeGreaterThanOrEqual(0);

    for (const file of files.slice(correctiveIndex + 1)) {
      const sql = stripComments(readFileSync(join(migrationsDir, file), "utf8"));
      expect(sql, `${file} must not recreate the trigger`).not.toMatch(
        /create\s+(or\s+replace\s+)?trigger\s+sync_authenticated_user_after_insert/i,
      );
      expect(sql, `${file} must not recreate the sync function`).not.toMatch(
        /create\s+(or\s+replace\s+)?function\s+public\.sync_authenticated_user/i,
      );
    }
  });

  it("removes both the trigger and the function in the corrective migration", () => {
    const sql = executableSql("0002_remove_auth_user_sync_trigger");
    expect(sql).toMatch(
      /drop\s+trigger\s+if\s+exists\s+sync_authenticated_user_after_insert\s+on\s+auth\.users/i,
    );
    expect(sql).toMatch(/drop\s+function\s+if\s+exists\s+public\.sync_authenticated_user\(\)/i);
  });

  it("introduces no privilege escalation in the corrective migration", () => {
    const sql = executableSql("0002_remove_auth_user_sync_trigger");
    const forbidden: Array<[RegExp, string]> = [
      [/\bbypassrls\b/i, "a BYPASSRLS role"],
      [/disable\s+row\s+level\s+security/i, "disabling row level security"],
      [/\bsecurity\s+definer\b/i, "a SECURITY DEFINER function"],
      [/create\s+policy/i, "a new policy"],
      [/\bto\s+service_role\b/i, "a service-role grant"],
      [/drop\s+policy/i, "dropping a policy"],
      [/\brevoke\b/i, "revoking an existing grant"],
    ];
    for (const [pattern, description] of forbidden) {
      expect(sql, `migration 0002 must not introduce ${description}`).not.toMatch(pattern);
    }
  });
});
