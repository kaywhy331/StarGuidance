import { readFileSync, writeFileSync } from "node:fs";

import { redact, type StagingResult, type StagingStatus } from "./staging-result";

/**
 * Renders the recorded results into the single redacted Markdown document that
 * is published to the job summary, uploaded as the only artifact, and copied
 * into the draft pull request.
 */
const SECTION_ORDER = [
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
  "Hosted log review",
  "Accessibility",
] as const;

const ICON: Record<StagingStatus, string> = {
  pass: "✅",
  fail: "❌",
  skipped: "⏭️",
  limited: "⚠️",
};

const [resultsFile, outputFile] = process.argv.slice(2);
if (!resultsFile || !outputFile)
  throw new Error("usage: render-staging-summary <results> <output>");

const results: StagingResult[] = readFileSync(resultsFile, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line) as StagingResult);

const counts = results.reduce<Record<string, number>>((totals, { status }) => {
  totals[status] = (totals[status] ?? 0) + 1;
  return totals;
}, {});

const failed = (counts.fail ?? 0) > 0;
const lines: string[] = [
  "# Supabase staging verification",
  "",
  `**Gate result: ${failed ? "FAILED" : "PASSED"}** — ` +
    `${counts.pass ?? 0} passed, ${counts.fail ?? 0} failed, ` +
    `${counts.limited ?? 0} limited, ${counts.skipped ?? 0} skipped.`,
  "",
  "All values below are redacted status text. No secret, connection string, token, " +
    "link, cookie, email address, or raw identifier is recorded.",
  "",
];

const ordered = [
  ...SECTION_ORDER,
  ...[...new Set(results.map(({ section }) => section))].filter(
    (section) => !SECTION_ORDER.includes(section as (typeof SECTION_ORDER)[number]),
  ),
];

for (const section of ordered) {
  const entries = results.filter((result) => result.section === section);
  if (entries.length === 0) continue;
  lines.push(`## ${section}`, "", "| Check | Result | Detail |", "| --- | --- | --- |");
  for (const entry of entries)
    lines.push(
      `| ${redact(entry.check)} | ${ICON[entry.status]} ${entry.status} | ${redact(entry.detail)} |`,
    );
  lines.push("");
}

lines.push(
  "## Scope of this evidence",
  "",
  "- Automated scanning is not a human WCAG 2.2 AA certification.",
  "- A positive magic-link `?code=` exchange still requires the owner's one-time real-inbox",
  "  smoke test; this run verifies passwordless initiation and the fail-closed callback paths.",
  "- Live AI, Stripe, observability, backup/restore, key rotation, Western astrology, BaZi,",
  "  Dreamspell, legal/pricing/retention policy, and artwork distribution remain separate gates.",
  "",
);

const summary = lines.join("\n");
writeFileSync(outputFile, summary, "utf8");
process.stdout.write(failed ? "gate=failed\n" : "gate=passed\n");
if (failed) process.exitCode = 1;
