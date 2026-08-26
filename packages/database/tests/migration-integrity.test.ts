import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { EXPECTED_MIGRATIONS } from "../src/migration-manifest";

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
  "0003_webhook_replay_lease": "ba0cfa16d9a3256e98c43d2a62b6b5e6cad5bcae328ccec0a61f45088f62b9f9",
  "0004_server_actor_role": "32dd231cbe55ef316ef71896b1fc9f11af1772c4fdc0722cd58efc3b2fa76aad",
  "0005_bumpy_moon_knight": "e63e5b2af79a8b635292feffe0441a18f22a28fa4700dc1bc58d010a6fc4b794",
  "0006_rate_limit_buckets": "c4f29725cc7ba2e54f77a24b585e4cb8e596262cbe03b184b7f8dfbe635141c8",
  "0007_interpretation_jobs": "ca141a5257796e0e3c23caba1413cf8bb606fcb499eb39c5d94655c5831e4bee",
  "0008_interpretation_jobs_subject_rls":
    "d5aecc953a81ec0a4a42b4876593248969144d53f3099ccdcc89f5a413340557",
  "0009_profile_snapshot_immutability":
    "d228d35758f7bd7fa722cc2e95572a7cadca3570ed93b584db768c1420291bf4",
  "0010_deletion_receipts": "c493ef6415cfbbf7625a17654f46303494c7bf25c219bb76713144f571fe9178",
  "0011_reading_flow_controls": "07de96da150bacd6f3e028165508ddcc4d94c49b420fc5d5985f303b4f54c823",
  "0012_commerce_report_jobs": "ae71077d80d026d3cd14738521908d4aa4499b3dd2a30517adbfd8f6d115f8ff",
  "0013_checkout_report_source": "94c13c7badf5be7b7ebd86111c2c8970e724ffa15968104fd5771d60e9e0b54d",
  "0014_account_consent_settings":
    "79dab4d38987a7d32b807760a25d3e06d09f4a33fcebcd98ff965744737c277c",
  "0015_consent_event_history": "826a4e1a4f186f96640ad661df47b7c6d7fce9ea8d3dd5a42d126b80f19a9b16",
  "0016_reading_intake_recovery":
    "783c256a90a1a8500a31ef9c12b83fd9e4020891fc612a99e2e374ed0fb8d1b6",
  "0017_sound-on-by-default": "3d3b98ed3d8215be7826057b853d7f006641871ded256200850247844f8d5565",
  "0018_reading_outcome_feedback":
    "ffa50fe9f19250b00dcb632b2f11ebd9a65b4d38eecc19346b658a4e6d315c60",
  "0019_privacy_safe_product_events":
    "4f4cf3fb0b1aa3d8d3e7bcf92d721145615d6099ba7385b082770765813cdb6a",
  "0020_wonderful_thunderball": "c6478e72b5ac0b11694122ec6b7e5e120519a1f94f75e50741f2ddf4b19815dc",
  "0021_optimal_frightful_four": "620be686d4a1602b6f449ac0fa3dfb9cbca06d9d27e395dd4db420c0a5951aef",
  "0022_outstanding_smasher": "e3bbebde9605b48ae7829834b278273775aaddc6f78f0074ca30cfb1c360cdf4",
  "0023_output_provenance": "238cc827f006c73a66326b726d31b0f4df8f419c8ce8ae1334f53e0994b182a0",
  "0024_immutable_content_versions":
    "bee71d381cd1a2206d428841f9d795fbe7e2c8cf8833a50e2e4c78c5f5ce452e",
  "0025_committed_draw_lifecycle":
    "cfd7055877f764cf098108223c977b8f9658076e7b67bc9da08c93ec669bbb8c",
  "0026_relationship_profiles": "bf9c00a7e1b1e2446425bc499ff506b828d142efe3b6495a1efa7e0b5c01d557",
};

describe("migration history", () => {
  it("keeps every applied migration byte-identical", () => {
    for (const [tag, expected] of Object.entries(IMMUTABLE_DIGESTS)) {
      expect(digest(tag), `${tag}.sql was edited after it was applied`).toBe(expected);
    }
  });

  it("retains consent grants while recording reversible withdrawal (0014)", () => {
    const sql = executableSql("0014_account_consent_settings");
    expect(sql).toMatch(/alter table "consents" add column "withdrawn_at"/i);
    expect(sql).not.toMatch(/drop|delete/i);
  });

  it("preserves every consent cycle while allowing only one active grant (0015)", () => {
    const sql = executableSql("0015_consent_event_history");
    expect(sql).toMatch(/drop\s+index\s+"consent_policy_version_unique"/i);
    expect(sql).toMatch(
      /create\s+unique\s+index\s+"consent_active_policy_version_unique"[\s\S]*where[\s\S]*withdrawn_at[\s\S]*is\s+null/i,
    );
    expect(sql).not.toMatch(/delete\s+from\s+"?consents"?/i);
  });

  it("stores intake classification, entitlement, expiry, and recovery separately (0016)", () => {
    const sql = executableSql("0016_reading_intake_recovery");
    for (const column of [
      "question_classification",
      "entitlement_decision",
      "ritual_progress",
      "expires_at",
    ])
      expect(sql).toMatch(new RegExp(`add column "${column}"`, "i"));
    expect(sql).not.toMatch(/drop|delete/i);
  });

  it("changes only the default for new sound preferences (0017)", () => {
    const sql = executableSql("0017_sound-on-by-default");
    expect(sql).toMatch(/alter column "sound_enabled" set default true/i);
    expect(sql).not.toMatch(/update|delete|drop/i);
  });

  it("adds distinct experience and outcome feedback fields without rewriting history (0018)", () => {
    const sql = executableSql("0018_reading_outcome_feedback");
    for (const column of ["kind", "outcome_status", "behavior_changed"])
      expect(sql).toMatch(new RegExp(`add column "${column}"`, "i"));
    expect(sql).not.toMatch(/update|delete|drop/i);
  });

  it("keeps privacy-safe product events aggregate-only and app-only (0019)", () => {
    const sql = executableSql("0019_privacy_safe_product_events");
    expect(sql).toMatch(/create\s+table\s+"product_events"/i);
    expect(sql).not.toMatch(/user_id|email|birth|question|card_id|pathname|url/i);
    expect(sql).toMatch(/alter\s+table\s+"product_events"\s+force\s+row\s+level\s+security/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+"product_events"\s+from\s+public,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+select,\s*insert\s+on\s+table\s+"product_events"\s+to\s+starguidance_app/i,
    );
    expect(sql).not.toMatch(/grant\s+(update|delete)|bypassrls|security\s+definer/i);
  });

  it("enforces the telemetry vocabulary and outcome-feedback invariants (0020)", () => {
    const sql = executableSql("0020_wonderful_thunderball");
    for (const constraint of [
      "product_events_digest",
      "product_events_name",
      "product_events_properties_object",
      "product_events_property_vocabulary",
      "reading_feedback_rating_range",
      "reading_feedback_kind_contract",
    ])
      expect(sql).toMatch(new RegExp(`add constraint "${constraint}"`, "i"));
    expect(sql).toMatch(/outcome_submitted/i);
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security|bypassrls|security\s+definer/i);
  });

  it("creates an append-preserving, independently approved runtime control plane (0021)", () => {
    const sql = executableSql("0021_optimal_frightful_four");
    expect(sql).toMatch(/create\s+table\s+"runtime_configuration_versions"/i);
    expect(sql).toMatch(/runtime_configuration_domain_version_unique/i);
    expect(sql).toMatch(/runtime_configuration_one_published/i);
    expect(sql).toMatch(/runtime_configuration_independent_approval/i);
    expect(sql).toMatch(/create\s+function\s+protect_runtime_configuration_release/i);
    expect(sql).toMatch(/create\s+trigger\s+runtime_configuration_release_immutable/i);
    expect(sql).toMatch(
      /alter\s+table\s+"runtime_configuration_versions"\s+force\s+row\s+level\s+security/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+"runtime_configuration_versions"\s+from\s+public,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+select,\s*insert\s+on\s+table\s+"runtime_configuration_versions"\s+to\s+starguidance_app/i,
    );
    expect(sql).toMatch(
      /grant\s+update\s*\(status,\s*approved_by,\s*approved_at,\s*published_at\)[\s\S]*to\s+starguidance_app/i,
    );
    expect(sql).not.toMatch(/grant\s+update\s+on\s+table/i);
    expect(sql).not.toMatch(/grant\s+delete|bypassrls|security\s+definer/i);
  });

  it("extends only the closed operational-event vocabulary (0022)", () => {
    const sql = executableSql("0022_outstanding_smasher");
    expect(sql).toMatch(/drop\s+constraint\s+"product_events_name"/i);
    expect(sql).toMatch(/add\s+constraint\s+"product_events_name"/i);
    expect(sql).toMatch(/auth_failed/i);
    expect(sql).toMatch(/generation_completed/i);
    expect(sql).not.toMatch(/alter\s+table[\s\S]*drop\s+column|delete\s+from/i);
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security|bypassrls|security\s+definer/i);
  });

  it("records complete provenance for new primary and follow-up outputs (0023)", () => {
    const sql = executableSql("0023_output_provenance");
    for (const column of [
      "provider_id",
      "prompt_version",
      "content_version",
      "safety_policy_version",
      "schema_version",
    ])
      expect(sql).toMatch(
        new RegExp(
          `alter table "follow_up_questions" add column "${column}" text default 'legacy-unrecorded' not null`,
          "i",
        ),
      );
    expect(sql).toMatch(
      /alter table "reading_outputs" add column "safety_policy_version" text default 'legacy-unrecorded' not null/i,
    );
    expect(sql).not.toMatch(/delete\s+from|drop\s+column|disable\s+row\s+level\s+security/i);
  });

  it("preserves historical tarot releases under version-qualified keys (0024)", () => {
    const sql = executableSql("0024_immutable_content_versions");

    expect(sql).toMatch(
      /update\s+"card_meanings"[\s\S]*set\s+"deck_version"\s*=\s*card\."deck_version"[\s\S]*from\s+"cards"/i,
    );
    expect(sql).toMatch(
      /update\s+"spread_positions"[\s\S]*set\s+"spread_version"\s*=\s*spread\."version"[\s\S]*from\s+"spreads"/i,
    );
    expect(sql).toMatch(
      /add\s+constraint\s+"cards_id_deck_version_pk"\s+primary\s+key\s*\("id",\s*"deck_version"\)/i,
    );
    expect(sql).toMatch(
      /add\s+constraint\s+"spreads_id_version_pk"\s+primary\s+key\s*\("id",\s*"version"\)/i,
    );
    expect(sql).toMatch(
      /foreign\s+key\s*\("card_id",\s*"deck_version"\)[\s\S]*references\s+"public"\."cards"\("id",\s*"deck_version"\)/i,
    );
    expect(sql).toMatch(
      /foreign\s+key\s*\("spread_id",\s*"spread_version"\)[\s\S]*references\s+"public"\."spreads"\("id",\s*"version"\)/i,
    );
    expect(sql).toMatch(/alter\s+column\s+"deck_version"\s+set\s+not\s+null/i);
    expect(sql).toMatch(/alter\s+column\s+"spread_version"\s+set\s+not\s+null/i);
    expect(sql).not.toMatch(/delete\s+from|truncate|drop\s+column/i);
    expect(sql).not.toMatch(/update\s+"(?:cards|spreads)"|set\s+"(?:payload|id|content_version)"/i);
  });

  it("adds committed-draw proof and immutable reading configuration without rewriting history (0025)", () => {
    const sql = executableSql("0025_committed_draw_lifecycle");
    expect(sql).toMatch(/alter\s+table\s+"reading_draws"\s+add\s+column\s+"proof"\s+jsonb/i);
    expect(sql).toMatch(
      /alter\s+table\s+"reading_draws"\s+add\s+column\s+"encrypted_server_seed"\s+text/i,
    );
    expect(sql).toMatch(
      /alter\s+table\s+"reading_sessions"\s+add\s+column\s+"configuration"\s+jsonb/i,
    );
    expect(sql).not.toMatch(/delete\s+from|truncate|drop\s+(?:table|column)/i);
  });

  it("adds encrypted relationship profiles and a locked minimized reading lens (0026)", () => {
    const sql = executableSql("0026_relationship_profiles");
    expect(sql).toMatch(/create\s+table\s+"relationship_profiles"/i);
    expect(sql).toMatch(/create\s+table\s+"relationship_profile_snapshots"/i);
    expect(sql).toMatch(/encrypted_input"\s+text\s+not\s+null/i);
    expect(sql).toMatch(/encrypted_calculations"\s+text\s+not\s+null/i);
    expect(sql).toMatch(/encrypted_related_person_lens"\s+text/i);
    expect(sql).toMatch(/relationship_profile_snapshots_owner/i);
    expect(sql).toMatch(/force\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/delete\s+from|truncate|drop\s+(?:table|column)/i);
  });

  it("orders the corrective migration after the migration that created the trigger", () => {
    const tags = journal.entries.sort((a, b) => a.idx - b.idx).map(({ tag }) => tag);
    expect(tags).toEqual(EXPECTED_MIGRATIONS);
    expect(Object.keys(IMMUTABLE_DIGESTS)).toEqual(EXPECTED_MIGRATIONS);
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

  it("keeps the server actor non-login, non-inheriting, and subject-scoped", () => {
    const sql = executableSql("0004_server_actor_role");
    expect(sql).toMatch(/create\s+role\s+starguidance_app\s+nologin/i);
    expect(sql).toMatch(/noinherit/i);
    expect(sql).toMatch(/nobypassrls/i);
    expect(sql).toMatch(/revoke\s+all[\s\S]*from\s+public,\s*authenticated/i);
    expect(sql).not.toMatch(/\bbypassrls\b(?!\s*\))/i);
    expect(sql).not.toMatch(/security\s+definer/i);
  });

  it("scrubs legacy plaintext profile metadata and enforces retry-safe cardinality", () => {
    const sql = executableSql("0005_bumpy_moon_knight");
    expect(sql).toMatch(/derived_payload"\s*=\s*"derived_payload"\s*-\s*'metadata'/i);
    expect(sql).toMatch(/set\s+"idempotency_key"\s*=\s*"id"::text/i);
    expect(sql).toMatch(/birth_profiles_user_unique/i);
    expect(sql).toMatch(/follow_up_questions_reading_unique/i);
    expect(sql).toMatch(/reading_sessions_user_idempotency_unique/i);
  });

  it("keeps rate_limit_buckets forced-RLS and reachable only by starguidance_app", () => {
    const sql = executableSql("0006_rate_limit_buckets");
    expect(sql).toMatch(/alter\s+table\s+"rate_limit_buckets"\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/alter\s+table\s+"rate_limit_buckets"\s+force\s+row\s+level\s+security/i);
    expect(sql).toMatch(/create\s+policy[\s\S]*on\s+"rate_limit_buckets"/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+"rate_limit_buckets"\s+from\s+public,\s*authenticated/i,
    );
    expect(sql).toMatch(/grant[\s\S]*on\s+table\s+"rate_limit_buckets"\s+to\s+starguidance_app/i);
    expect(sql).not.toMatch(/\bbypassrls\b/i);
    expect(sql).not.toMatch(/security\s+definer/i);
    expect(sql).not.toMatch(/\bto\s+(anon|service_role)\b/i);
  });

  it("keeps interpretation_jobs forced-RLS and reachable only by starguidance_app", () => {
    const sql = executableSql("0007_interpretation_jobs");
    expect(sql).toMatch(/alter\s+table\s+"interpretation_jobs"\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/alter\s+table\s+"interpretation_jobs"\s+force\s+row\s+level\s+security/i);
    expect(sql).toMatch(/create\s+policy[\s\S]*on\s+"interpretation_jobs"/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+"interpretation_jobs"\s+from\s+public,\s*authenticated/i,
    );
    expect(sql).not.toMatch(/\bbypassrls\b/i);
    expect(sql).not.toMatch(/security\s+definer/i);
    expect(sql).not.toMatch(/\bto\s+(anon|service_role)\b/i);
    // Unlike payment_webhook_events (migration 0004), starguidance_app
    // deliberately keeps INSERT here too: POST /api/readings enqueues a job in
    // the same actor-bound transaction as the reading it belongs to (see this
    // migration's own inline comment).
    expect(sql).toMatch(
      /grant\s+select,\s*insert,\s*update,\s*delete\s+on\s+table\s+"interpretation_jobs"\s+to\s+starguidance_app/i,
    );
  });

  it("subject-binds the interpretation_jobs actor policy and names the system path (0008)", () => {
    const sql = executableSql("0008_interpretation_jobs_subject_rls");
    expect(sql).toMatch(/drop\s+policy\s+"interpretation_jobs_app_only"/i);
    // The request path: scoped to the app role and bound to the verified
    // subject in both directions (visibility and new rows).
    expect(sql).toMatch(
      /create\s+policy\s+"interpretation_jobs_subject"[\s\S]*to\s+starguidance_app[\s\S]*using\s*\("user_id"\s*=\s*nullif\(current_setting\('request\.jwt\.claim\.sub',\s*true\),\s*''\)::uuid\)[\s\S]*with\s+check\s*\("user_id"\s*=\s*nullif\(current_setting\('request\.jwt\.claim\.sub',\s*true\),\s*''\)::uuid\)/i,
    );
    // The claim path: an explicit policy for the owning connection role, so
    // cross-user maintenance is a named, reviewable grant rather than the
    // absence of RLS (contrast payment_webhook_events).
    expect(sql).toMatch(
      /create\s+policy\s+"interpretation_jobs_system"[\s\S]*to\s+current_user[\s\S]*using\s*\(true\)/i,
    );
    // No RLS weakening while re-cutting the policies.
    expect(sql).not.toMatch(/no\s+force\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/\bbypassrls\b/i);
    expect(sql).not.toMatch(/security\s+definer/i);
    expect(sql).not.toMatch(/\bto\s+(anon|service_role|public|authenticated)\b/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
  });

  it("makes profile snapshots immutable with a guard trigger and narrowed grants (0009)", () => {
    const sql = executableSql("0009_profile_snapshot_immutability");
    expect(sql).toMatch(
      /create\s+trigger\s+profile_snapshots_immutable\s+before\s+update\s+on\s+profile_snapshots/i,
    );
    expect(sql).toMatch(/raise\s+exception/i);
    for (const table of ["profile_snapshots", "profile_traits"]) {
      expect(sql).toMatch(
        new RegExp(
          String.raw`revoke\s+update,\s*delete\s+on\s+table\s+${table}\s+from\s+starguidance_app`,
          "i",
        ),
      );
    }
    // profile_components keeps subject-scoped UPDATE — the RLS-scoped
    // key-rotation rehearsal re-encrypts envelope payloads as the actor
    // role — but loses DELETE like the rest of the lineage.
    expect(sql).toMatch(
      /revoke\s+delete\s+on\s+table\s+profile_components\s+from\s+starguidance_app/i,
    );
    expect(sql).not.toMatch(/revoke\s+update,\s*delete\s+on\s+table\s+profile_components/i);
    expect(sql).not.toMatch(/security\s+definer/i);
    expect(sql).not.toMatch(/\bgrant\b/i);
    // The trigger must not touch DELETE — rows leave via the enforced FK
    // cascades (user/profile deletion), and a delete trigger would block them.
    expect(sql).not.toMatch(/before\s+delete/i);
  });

  it("creates cascade-proof, append-only deletion receipts (0010)", () => {
    const sql = executableSql("0010_deletion_receipts");
    // User-less by construction: no user_id column, no foreign keys at all —
    // a cascade that can reach this table would defeat its purpose.
    expect(sql).not.toMatch(/user_id/i);
    expect(sql).not.toMatch(/references/i);
    expect(sql).toMatch(/"subject_hash"\s+text\s+not\s+null/i);
    expect(sql).toMatch(/"policy_version"\s+text\s+not\s+null/i);
    expect(sql).toMatch(/alter\s+table\s+"deletion_receipts"\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/alter\s+table\s+"deletion_receipts"\s+force\s+row\s+level\s+security/i);
    // The application role may only append; reads are the connection role's.
    expect(sql).toMatch(
      /create\s+policy\s+"deletion_receipts_append"[\s\S]*for\s+insert\s+to\s+starguidance_app/i,
    );
    expect(sql).toMatch(/create\s+policy\s+"deletion_receipts_system"[\s\S]*to\s+current_user/i);
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+"deletion_receipts"\s+from\s+public,\s*authenticated/i,
    );
    expect(sql).toMatch(
      /grant\s+insert\s+on\s+table\s+"deletion_receipts"\s+to\s+starguidance_app/i,
    );
    expect(sql).not.toMatch(/grant\s+(select|update|delete)[\s\S]*starguidance_app/i);
    expect(sql).not.toMatch(/security\s+definer/i);
  });

  it("adds active content controls and removes singleton follow-ups (0011)", () => {
    const sql = executableSql("0011_reading_flow_controls");
    expect(sql).toMatch(/drop\s+index\s+"follow_up_questions_reading_unique"/i);
    expect(sql).toMatch(/create\s+index\s+"follow_up_questions_reading_idx"[\s\S]*"reading_id"/i);
    for (const table of ["decks", "spreads"])
      expect(sql).toMatch(
        new RegExp(
          String.raw`alter\s+table\s+"${table}"\s+add\s+column\s+"active"\s+boolean\s+default\s+true\s+not\s+null`,
          "i",
        ),
      );
  });

  it("queues reports durably and separates commerce from profile deletion (0012)", () => {
    const sql = executableSql("0012_commerce_report_jobs");
    expect(sql).toMatch(/create\s+table\s+"report_jobs"/i);
    for (const table of ["orders", "entitlements", "reports"])
      expect(sql).toMatch(
        new RegExp(
          String.raw`alter\s+table\s+"${table}"\s+add\s+constraint[\s\S]*profile_snapshot[\s\S]*on\s+delete\s+set\s+null`,
          "i",
        ),
      );
    expect(sql).toMatch(/alter\s+table\s+"report_jobs"\s+enable\s+row\s+level\s+security/i);
    expect(sql).toMatch(/alter\s+table\s+"report_jobs"\s+force\s+row\s+level\s+security/i);
    expect(sql).toMatch(
      /create\s+policy\s+"report_jobs_subject"[\s\S]*to\s+starguidance_app[\s\S]*request\.jwt\.claim\.sub/i,
    );
    expect(sql).toMatch(
      /create\s+policy\s+"report_jobs_system"[\s\S]*to\s+current_user[\s\S]*using\s*\(true\)/i,
    );
    expect(sql).toMatch(
      /revoke\s+all\s+on\s+table\s+"report_jobs"\s+from\s+public,\s*authenticated/i,
    );
    expect(sql).not.toMatch(/security\s+definer/i);
    expect(sql).not.toMatch(/\bbypassrls\b/i);
  });

  it("stages the minimized Checkout report source before payment (0013)", () => {
    const sql = executableSql("0013_checkout_report_source");
    expect(sql).toMatch(
      /alter\s+table\s+"orders"\s+add\s+column\s+"encrypted_report_source"\s+text/i,
    );
  });
});
