import { readdirSync, readFileSync, writeFileSync } from "node:fs";

import { evaluateGate, SUCCESS_MARKER, type GateStatus } from "./staging-gate";
import { completeStage, redact, type StagingResult, type StagingStatus } from "./staging-result";

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
  "Identity provisioning",
  "Profile persistence",
  "Profile lineage",
  "Reading creation",
  "Draw equality",
  "Cross-user isolation",
  "Export",
  "Deletion",
  "Key rotation",
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
// Rendering is itself the `summary` stage. Its marker is written at the end of
// this script, so include it here or the document would always report itself as
// the one stage that did not complete. The authoritative decision is made by the
// separate gate step, which reads the marker from disk after this script exits.
const stages = [...new Set([...readStages(), "summary"])];
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
  "- Routine password sign-in is automated with an ephemeral identity. Signup-confirmation and",
  "  recovery delivery still require the owner's one-time real-inbox smoke test.",
  "- Live AI, Stripe, observability, provider-managed backup/restore and secret-store cutover,",
  "  Western astrology, BaZi, Dreamspell, legal/pricing/retention policy, and artwork",
  "  distribution remain separate gates.",
  "",
);

writeFileSync(outputFile, lines.join("\n"), "utf8");
// Rendering is itself a mandatory stage: a run that produced no publishable,
// redacted evidence has demonstrated nothing, whatever else succeeded. The
// marker is written after the file exists, and the gate step reads it next.
completeStage("summary");
process.stdout.write(`gate=${verdict.status}\n`);
if (verdict.status !== "passed") process.exitCode = 1;
