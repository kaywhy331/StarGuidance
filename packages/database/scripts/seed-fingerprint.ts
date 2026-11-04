import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { createDatabaseClient } from "../src/postgres-client";
import { record, requiredEnv } from "./staging-result";

/**
 * Captures a reference-data fingerprint so the second seed can be proven
 * idempotent. Run with `capture <file>` before and `compare <file>` after.
 */
const REFERENCE_TABLES = [
  "decks",
  "cards",
  "card_meanings",
  "spreads",
  "spread_positions",
  "products",
  "prompt_versions",
  "calculation_versions",
  "content_versions",
  "runtime_configuration_versions",
] as const;

interface TableFingerprint {
  count: number;
  sha256: string;
}

async function fingerprint(): Promise<Record<string, TableFingerprint>> {
  const sql = createDatabaseClient(requiredEnv("DATABASE_URL"));
  try {
    const fingerprints: Record<string, TableFingerprint> = {};
    for (const table of REFERENCE_TABLES) {
      const rows = await sql.unsafe<{ row: unknown }[]>(
        `select to_jsonb(reference_row) as row
         from public.${table} as reference_row
         order by to_jsonb(reference_row)::text`,
      );
      fingerprints[table] = {
        count: rows.length,
        sha256: createHash("sha256")
          .update(rows.map(({ row }) => JSON.stringify(row)).join("\n"), "utf8")
          .digest("hex"),
      };
    }
    return fingerprints;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

const [mode, file] = process.argv.slice(2);
if (!mode || !file) throw new Error("usage: seed-fingerprint <capture|compare> <file>");

const fingerprints = await fingerprint();

if (mode === "capture") {
  writeFileSync(file, JSON.stringify(fingerprints), "utf8");
  const total = Object.values(fingerprints).reduce((sum, value) => sum + value.count, 0);
  record({
    section: "Seed",
    check: "First seed populated reference data",
    status: total > 0 ? "pass" : "fail",
    detail: `cards=${fingerprints.cards?.count ?? 0} spreads=${fingerprints.spreads?.count ?? 0} positions=${fingerprints.spread_positions?.count ?? 0}`,
  });
  if (total <= 0) process.exitCode = 1;
} else if (mode === "compare") {
  const before = JSON.parse(readFileSync(file, "utf8")) as Record<string, TableFingerprint>;
  const drifted = REFERENCE_TABLES.filter(
    (table) =>
      before[table]?.count !== fingerprints[table]?.count ||
      before[table]?.sha256 !== fingerprints[table]?.sha256,
  );
  const idempotent = drifted.length === 0;
  record({
    section: "Seed",
    check: "Second seed is idempotent",
    status: idempotent ? "pass" : "fail",
    detail: idempotent
      ? `all ${REFERENCE_TABLES.length} reference tables byte-stable (cards=${fingerprints.cards?.count ?? 0})`
      : `${drifted.length} table(s) changed on the second run: ${drifted.join(", ")}`,
  });
  if (!idempotent) process.exitCode = 1;
} else {
  throw new Error(`unknown mode ${mode}`);
}
