import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type RequirementStatus = "Implemented" | "Partial" | "External gate" | "Gated compliant";

interface Requirement {
  id: string;
  priority: string;
}

const root = process.cwd();
const prdPath = resolve(root, "docs/PRD.md");
const outputPath = resolve(root, "docs/REQUIREMENTS-TRACEABILITY.md");

const routing: Record<string, { milestone: string; owner: string; evidence: string }> = {
  ACC: {
    milestone: "M2",
    owner: "Full-stack engineering",
    evidence: "`apps/web/src/app/api/auth/route.test.ts`; `apps/web/tests/e2e/mvp.spec.ts`",
  },
  PRO: {
    milestone: "M2/M3",
    owner: "Full-stack + profile-engine engineering",
    evidence:
      "`apps/web/src/lib/repositories/profile-storage.test.ts`; `apps/profile-engine/tests`; `apps/web/tests/e2e/mvp.spec.ts`",
  },
  CAL: {
    milestone: "M3",
    owner: "Profile-engine engineering + domain owners",
    evidence: "`apps/profile-engine/tests`; `docs/PROFILE-CALCULATIONS.md`",
  },
  RDG: {
    milestone: "M4",
    owner: "Full-stack + tarot content",
    evidence: "`packages/tarot-content/tests`; `apps/web/tests/e2e/mvp.spec.ts`",
  },
  DRW: {
    milestone: "M4",
    owner: "Full-stack engineering",
    evidence:
      "`packages/tarot-domain/tests/draw.test.ts`; `packages/database/src/repositories.integration.test.ts`; `apps/web/tests/e2e/mvp.spec.ts`",
  },
  UX: {
    milestone: "M1/M4",
    owner: "Product design + full-stack engineering",
    evidence:
      "`packages/reading-machine/tests/machine.test.ts`; `apps/web/tests/e2e/accessibility.spec.ts`; `apps/web/tests/e2e/visual.spec.ts`",
  },
  AI: {
    milestone: "M5",
    owner: "AI/content engineering + safety owner",
    evidence:
      "`packages/ai/tests`; `apps/web/src/lib/interpretation-worker.test.ts`; `docs/KNOWN-GAPS.md`",
  },
  RES: {
    milestone: "M5",
    owner: "Full-stack + product",
    evidence:
      "`apps/web/src/app/api/readings/[id]/route.test.ts`; `apps/web/tests/e2e/mvp.spec.ts`",
  },
  RPT: {
    milestone: "M6",
    owner: "Full-stack + commerce operations",
    evidence:
      "`apps/web/src/lib/report.test.ts`; `apps/web/src/lib/stripe-events.test.ts`; `apps/web/tests/e2e/mvp.spec.ts`",
  },
  ADM: {
    milestone: "M7",
    owner: "Full-stack engineering + operations",
    evidence:
      "`apps/web/src/app/api/operations/configuration/route.test.ts`; `packages/database/tests/migration-integrity.test.ts`; `docs/OPERATIONS.md`",
  },
  SEC: {
    milestone: "M7/M8",
    owner: "Security/privacy + full-stack engineering",
    evidence:
      "`packages/database/src/repositories.integration.test.ts`; `apps/web/src/lib/telemetry-boundary.test.ts`; `docs/SECURITY.md`",
  },
  NFR: {
    milestone: "M7/M8",
    owner: "Engineering + QA/operations",
    evidence:
      "`.github/workflows/ci.yml`; `apps/web/tests/e2e`; `netlify/functions-tests/process-interpretation-jobs.test.ts`",
  },
};

const externalGates: Readonly<Record<string, string>> = {
  "CAL-002": "Disabled pending a licensed ephemeris adapter and approved Western reference set.",
  "CAL-003": "Disabled pending certified house calculations and independent references.",
  "CAL-004": "Disabled pending certified 24-hour astronomical uncertainty references.",
  "CAL-006": "Disabled pending certified Placidus and polar-region reference behavior.",
  "CAL-007":
    "Deterministic suite exists; named owner approval of the reference set is outstanding.",
  "CAL-008": "Disabled pending approved BaZi reference cases and conventions.",
  "CAL-009": "Versioned contract exists; named BaZi convention approval is outstanding.",
  "CAL-010":
    "Deterministic suite exists; approved Dreamspell decoder dataset/rights sign-off is outstanding.",
  "CAL-015": "Repository tests exist; all-system named-expert golden approval is outstanding.",
  "CAL-016": "Synthetic latency gate exists; production-like p95 load evidence is outstanding.",
  "CAL-018": "Disabled pending approved Nine Star Ki boundary/third-star cases and content rights.",
  "AI-018": "Evaluation harness exists; signed model-by-model launch thresholds are outstanding.",
  "SEC-003":
    "Payload minimization is tested; provider no-retention/no-training production evidence is outstanding.",
  "SEC-005":
    "Secret boundaries are implemented; managed production secret-store evidence is outstanding.",
  "SEC-011":
    "Runbook exists; a provider-hosted restore rehearsal with named owners is outstanding.",
  "NFR-001": "Production-like representative-mobile p75 evidence is outstanding.",
  "NFR-002":
    "Automated motion paths exist; representative mid-tier device frame evidence is outstanding.",
  "NFR-004": "Bounded provider deadlines exist; expected-load p95 evidence is outstanding.",
  "NFR-005": "The 99.5% target is documented; hosted SLI/error-budget evidence is outstanding.",
  "NFR-006":
    "Automated accessibility coverage exists; named manual screen-reader/device sign-off is outstanding.",
};

const partialGates: Readonly<Record<string, string>> = {
  "UX-003":
    "Lightweight shells are implemented; physical mid-tier frame/memory evidence remains external.",
  "UX-005": "Responsive layouts are automated; manual 200% zoom/device review remains external.",
  "UX-011": "Touch/safe-area paths are implemented; physical-device acceptance remains external.",
  "UX-014":
    "Chromium/Firefox/WebKit lanes exist; real iOS/Android and previous-major UAT remains external.",
  "AI-017":
    "Token/time/model limits and aggregate cost proxy alerts are implemented; provider budget approval remains external.",
  "RPT-006":
    "Shared web/PDF JSON and parity tests exist; manual PDF/UA assistive-technology sign-off remains external.",
  "RPT-008":
    "Hosted Stripe adapter and return states are implemented; credentialed test-mode UAT remains external.",
  "SEC-004":
    "Closed telemetry schemas/redaction tests exist; production sampling approval remains external.",
  "SEC-012":
    "Automated scans and threat model exist; independent manual security review remains external.",
  "NFR-007":
    "Opaque entity IDs, queues, and aggregate signals exist; hosted cross-service trace correlation remains partial.",
  "NFR-008":
    "Closed alert evaluation/webhook delivery exists; receiver ownership and provider-native alerts remain external.",
};

const gatedCompliant: Readonly<Record<string, string>> = {
  "CAL-017":
    "Activation is fail-closed; the interface remains unavailable until ephemeris, license, location, line-math, and reference gates pass.",
};

function requirements(): Requirement[] {
  const source = readFileSync(prdPath, "utf8");
  const rows: Requirement[] = [];
  const pattern =
    /^\| \*\*([A-Z]+-\d+)\*\* \| .*? \| \*\*(Must(?: before activation)?)\*\* \| .*? \|$/gm;
  for (const match of source.matchAll(pattern)) rows.push({ id: match[1]!, priority: match[2]! });
  if (rows.length === 0) throw new Error("No Must requirements were found in docs/PRD.md");
  if (new Set(rows.map(({ id }) => id)).size !== rows.length)
    throw new Error("Duplicate Must requirement IDs exist in docs/PRD.md");
  return rows;
}

function statusFor(id: string): { status: RequirementStatus; note: string } {
  if (externalGates[id]) return { status: "External gate", note: externalGates[id] };
  if (partialGates[id]) return { status: "Partial", note: partialGates[id] };
  if (gatedCompliant[id]) return { status: "Gated compliant", note: gatedCompliant[id] };
  return {
    status: "Implemented",
    note: "Repository-controlled acceptance is implemented; release-command evidence belongs to the final PR receipt.",
  };
}

function assertKnownOverrides(found: readonly Requirement[]): void {
  const ids = new Set(found.map(({ id }) => id));
  for (const id of [
    ...Object.keys(externalGates),
    ...Object.keys(partialGates),
    ...Object.keys(gatedCompliant),
  ])
    if (!ids.has(id))
      throw new Error(`Traceability override references unknown Must requirement ${id}`);
}

function render(found: readonly Requirement[]): string {
  const counts: Record<RequirementStatus, number> = {
    Implemented: 0,
    Partial: 0,
    "External gate": 0,
    "Gated compliant": 0,
  };
  const rows = found.map((requirement) => {
    const prefix = requirement.id.split("-")[0]!;
    const route = routing[prefix];
    if (!route) throw new Error(`No traceability routing exists for ${requirement.id}`);
    const state = statusFor(requirement.id);
    counts[state.status] += 1;
    return `| ${requirement.id} | ${route.milestone} | ${route.owner} | T-${requirement.id} | ${state.status} | ${route.evidence} | ${state.note} |`;
  });
  return `# Must-requirement traceability\n\nThis ledger is generated from the **Must** and **Must before activation** rows in [PRD.md](PRD.md). It is deliberately stricter than a feature list: **Implemented** means repository-controlled behavior and automated evidence exist, not that an external production or expert gate has been signed. **Partial** and **External gate** requirements are not complete and have no implied waiver. **Gated compliant** means the feature remains technically unavailable until its activation-specific acceptance criteria pass.\n\nRun \`pnpm requirements:check\` to prove the ledger still contains every Must exactly once. Update the status maps in \`scripts/requirements-traceability.mts\`; never hand-edit this generated file.\n\nSummary: ${found.length} Must requirements — ${counts.Implemented} implemented, ${counts.Partial} partial, ${counts["External gate"]} external-gated, ${counts["Gated compliant"]} gated-compliant.\n\n<!-- prettier-ignore -->\n| Requirement | Milestone | Accountable owner | Test ID | Status | Automated/repository evidence | Remaining gate or interpretation |\n| --- | --- | --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`;
}

const found = requirements();
assertKnownOverrides(found);
const rendered = render(found);
if (process.argv.includes("--write")) {
  writeFileSync(outputPath, rendered, "utf8");
  process.stdout.write(
    `Wrote ${found.length} Must requirements to docs/REQUIREMENTS-TRACEABILITY.md\n`,
  );
} else if (process.argv.includes("--check")) {
  const current = readFileSync(outputPath, "utf8");
  if (current !== rendered)
    throw new Error(
      "docs/REQUIREMENTS-TRACEABILITY.md is stale; run pnpm exec tsx scripts/requirements-traceability.mts --write",
    );
  process.stdout.write(`Verified ${found.length} Must requirements exactly once\n`);
} else {
  throw new Error("Use --write or --check");
}
