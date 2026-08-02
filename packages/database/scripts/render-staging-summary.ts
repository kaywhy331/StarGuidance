import { readdirSync, readFileSync, writeFileSync } from "node:fs";

import { evaluateGate, SUCCESS_MARKER, type GateStatus } from "./staging-gate";
import { redact, type StagingResult, type StagingStatus } from "./staging-result";

/**
 * Renders the recorded results into the single redacted Markdown document that
 * is published to the job summary, uploaded as the only artifact, and copied
 * into the draft pull request.
 *
 * The heading is derived from the gate, never from a bare count of rows, so a
 * skipped or partial run cannot present itself as a pass.
 */
const SECTION_ORDER = [
  "Configuration",
  "Migrations",
  "Seed",
  "Row level security",
  "Profile engine",
  "Netlify runtime",
  "Auth callback",
  "Profile persistence",
  "Profile lineage",
  "Draw equality",
  "Cross-user isolation",
  "Export",
  "Deletion",
  "Cleanup",
  "Pipeline",
  "Hosted log review",
  "Accessibility",
] as const;

const ICON: Record<StagingStatus, string> = {
  pass: "✅",
  fail: "❌",
  skipped: "⏭️",
  limited: "⚠️",
};

const HEADLINE: Record<GateStatus, string> = {
  passed: "**Gate result: PASSED**",
  failed: "**Gate result: FAILED**",
  "not-run": "**Gate result: NOT RUN**",
};

const [resultsFile, outputFile, stageDir] = process.argv.slice(2);
if (!resultsFile || !outputFile)
  throw new Error("usage: render-staging-summary <results> <output> [stageDir]");

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
  if (!stageDir) return [];
  try {
    return readdirSync(stageDir);
  } catch {
    return [];
  }
}

const results = readResults();
const stages = readStages();
const verdict = evaluateGate({
  results,
  completedStages: stages.filter((stage) => stage !== SUCCESS_MARKER),
  successMarker: stages.includes(SUCCESS_MARKER),
});

const counts = results.reduce<Record<string, number>>((totals, { status }) => {
  totals[status] = (totals[status] ?? 0) + 1;
  return totals;
}, {});

const lines: string[] = [
  "# Supabase staging verification",
  "",
  `${HEADLINE[verdict.status]} — ${counts.pass ?? 0} passed, ${counts.fail ?? 0} failed, ` +
    `${counts.limited ?? 0} limited, ${counts.skipped ?? 0} skipped.`,
  "",
];

if (verdict.status !== "passed") {
  lines.push(
    verdict.status === "not-run"
      ? "No substantive verification stage ran, so nothing about the staging " +
          "environment has been demonstrated by this run."
      : "This run did not complete every mandatory stage. Treat the staging gate as open.",
    "",
    "Why this run cannot be reported as passed:",
    "",
  );
  for (const reason of verdict.reasons) lines.push(`- ${redact(reason)}`);
  lines.push("");
}

lines.push(
  "All values below are redacted status text. No secret, connection string, token, " +
    "link, cookie, email address, or raw identifier is recorded.",
  "",
);

const ordered = [
  ...SECTION_ORDER,
  ...[...new Set(results.map(({ section }) => section))].filter(
    (section) => !SECTION_ORDER.includes(section as (typeof SECTION_ORDER)[number]),
  ),
];

for (const section of ordered) {
  const entries = results.filter((entry) => entry.section === section);
  if (entries.length === 0) continue;
  lines.push(`## ${section}`, "", "| Check | Result | Detail |", "| --- | --- | --- |");
  for (const entry of entries)
    lines.push(
      `| ${redact(entry.check)} | ${ICON[entry.status]} ${entry.status} | ${redact(entry.detail)} |`,
    );
  lines.push("");
}

lines.push(
  "## Stage completion",
  "",
  "| Stage | Completed |",
  "| --- | --- |",
  ...[...new Set([...stages.filter((stage) => stage !== SUCCESS_MARKER), ...verdict.missingStages])]
    .sort()
    .map((stage) => `| ${stage} | ${stages.includes(stage) ? "✅ yes" : "❌ no"} |`),
  "",
  `Success marker present: ${stages.includes(SUCCESS_MARKER) ? "✅ yes" : "❌ no"}`,
  "",
  "## Scope of this evidence",
  "",
  "- Automated scanning is not a human WCAG 2.2 AA certification.",
  "- A positive magic-link `?code=` exchange still requires the owner's one-time real-inbox",
  "  smoke test; this run verifies passwordless initiation and the fail-closed callback paths.",
  "- Live AI, Stripe, observability, backup/restore, key rotation, Western astrology, BaZi,",
  "  Dreamspell, legal/pricing/retention policy, and artwork distribution remain separate gates.",
  "",
);

writeFileSync(outputFile, lines.join("\n"), "utf8");
process.stdout.write(`gate=${verdict.status}\n`);
if (verdict.status !== "passed") process.exitCode = 1;
