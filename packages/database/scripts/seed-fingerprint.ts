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
] as const;

async function fingerprint(): Promise<Record<string, number>> {
  const sql = createDatabaseClient(requiredEnv("DATABASE_URL"));
  try {
    const counts: Record<string, number> = {};
    for (const table of REFERENCE_TABLES) {
      const [row] = await sql.unsafe<{ count: number }[]>(
        `select count(*)::int as count from public.${table}`,
      );
      counts[table] = row?.count ?? -1;
    }
    return counts;
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

const [mode, file] = process.argv.slice(2);
if (!mode || !file) throw new Error("usage: seed-fingerprint <capture|compare> <file>");

const counts = await fingerprint();

if (mode === "capture") {
  writeFileSync(file, JSON.stringify(counts), "utf8");
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  record({
    section: "Seed",
    check: "First seed populated reference data",
    status: total > 0 ? "pass" : "fail",
    detail: `cards=${counts.cards} spreads=${counts.spreads} positions=${counts.spread_positions}`,
  });
  if (total <= 0) process.exitCode = 1;
} else if (mode === "compare") {
  const before = JSON.parse(readFileSync(file, "utf8")) as Record<string, number>;
  const drifted = REFERENCE_TABLES.filter((table) => before[table] !== counts[table]);
  const idempotent = drifted.length === 0;
  record({
    section: "Seed",
    check: "Second seed is idempotent",
    status: idempotent ? "pass" : "fail",
    detail: idempotent
      ? `all ${REFERENCE_TABLES.length} reference tables unchanged (cards=${counts.cards})`
      : `${drifted.length} table(s) changed on the second run: ${drifted.join(", ")}`,
  });
  if (!idempotent) process.exitCode = 1;
} else {
  throw new Error(`unknown mode ${mode}`);
}
