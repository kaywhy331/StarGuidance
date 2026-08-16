import { readdirSync, readFileSync } from "node:fs";

import { evaluateGate, SUCCESS_MARKER } from "./staging-gate";
import type { StagingResult } from "./staging-result";

/**
 * Decides the job outcome from recorded evidence and stage markers.
 *
 * Exits non-zero unless every mandatory stage completed, the success marker
 * exists, and no recorded result is a failure.
 */
const [resultsFile, stageDir] = process.argv.slice(2);
if (!resultsFile || !stageDir) throw new Error("usage: run-staging-gate <results> <stageDir>");

function readResults(): StagingResult[] {
  try {
    return readFileSync(resultsFile, "utf8")
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as StagingResult);
  } catch {
    return [];
  }
}

function readStages(): string[] {
  try {
    return readdirSync(stageDir);
  } catch {
    return [];
  }
}

const stages = readStages();
const verdict = evaluateGate({
  results: readResults(),
  completedStages: stages.filter((stage) => stage !== SUCCESS_MARKER),
  successMarker: stages.includes(SUCCESS_MARKER),
});

if (verdict.status === "passed") {
  process.stdout.write("Staging verification gate passed: every mandatory stage completed.\n");
  process.exit(0);
}

process.stdout.write(`Staging verification gate: ${verdict.status.toUpperCase()}\n`);
for (const reason of verdict.reasons) process.stdout.write(`  - ${reason}\n`);
process.stdout.write(
  `::error::Staging verification did not pass (${verdict.status}). See the job summary.\n`,
);
process.exit(1);
