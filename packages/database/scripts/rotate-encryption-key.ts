import {
  decryptSensitive,
  decryptSensitiveWithKeys,
  encryptSensitive,
  isValidEncryptionKey,
} from "../src/encryption";
import { APPLICATION_DATABASE_ROLE } from "../src/database-role";
import {
  createDatabaseClient,
  type DatabaseClient,
  type DatabaseRow,
} from "../src/postgres-client";

type RotationMode = "inventory" | "reencrypt" | "verify-current";
type EncryptedRow = { id: string; envelope: string };
type RotationSummary = { total: number; current: number; previous: number; changed: number };

const BATCH_SIZE = 100;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function mode(): RotationMode {
  const value = process.env.KEY_ROTATION_MODE ?? "inventory";
  if (value !== "inventory" && value !== "reencrypt" && value !== "verify-current")
    throw new Error("KEY_ROTATION_MODE must be inventory, reencrypt, or verify-current");
  if (value === "reencrypt" && process.env.KEY_ROTATION_CONFIRM !== "REENCRYPT_WITH_CURRENT_KEY")
    throw new Error("Re-encryption requires KEY_ROTATION_CONFIRM=REENCRYPT_WITH_CURRENT_KEY");
  return value;
}

function keys(): { current: string; previous: string[] } {
  const current = required("DATA_ENCRYPTION_KEY");
  const previous = (process.env.DATA_ENCRYPTION_KEYS_PREVIOUS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!isValidEncryptionKey(current) || previous.some((key) => !isValidEncryptionKey(key)))
    throw new Error("Every configured encryption key must be canonical base64 for 32 bytes");
  if (previous.length === 0)
    throw new Error("DATA_ENCRYPTION_KEYS_PREVIOUS must retain at least one rollback key");
  if (previous.length > 3)
    throw new Error("DATA_ENCRYPTION_KEYS_PREVIOUS accepts at most three rollback keys");
  const distinctPrevious = [...new Set(previous.filter((key) => key !== current))];
  if (distinctPrevious.length === 0)
    throw new Error("A rollback key must be distinct from DATA_ENCRYPTION_KEY");
  return { current, previous: distinctPrevious };
}

interface Target {
  name: string;
  load(sql: DatabaseClient, afterId: string | null): Promise<EncryptedRow[]>;
  replace(sql: DatabaseClient, row: EncryptedRow, envelope: string): Promise<boolean>;
}

function rows(result: DatabaseRow[]): EncryptedRow[] {
  return result.map((row) => ({ id: String(row.id), envelope: String(row.envelope) }));
}

const targets: Target[] = [
  {
    name: "birth_profiles.encrypted_payload",
    async load(sql, afterId) {
      return rows(
        await sql`
          select id, encrypted_payload as envelope from birth_profiles
          where (${afterId}::uuid is null or id > ${afterId}::uuid)
          order by id limit ${BATCH_SIZE}`,
      );
    },
    async replace(sql, row, envelope) {
      const updated = await sql`
        update birth_profiles set encrypted_payload = ${envelope}, updated_at = now()
        where id = ${row.id} and encrypted_payload = ${row.envelope} returning id`;
      return updated.length === 1;
    },
  },
  {
    name: "profile_components.payload.envelope",
    async load(sql, afterId) {
      return rows(
        await sql`
          select id, payload->>'envelope' as envelope from profile_components
          where system in ('private-profile-input', 'private-calculations')
            and payload ? 'envelope'
            and (${afterId}::uuid is null or id > ${afterId}::uuid)
          order by id limit ${BATCH_SIZE}`,
      );
    },
    async replace(sql, row, envelope) {
      const updated = await sql`
        update profile_components
        set payload = jsonb_set(payload, '{envelope}', to_jsonb(${envelope}::text), false)
        where id = ${row.id} and payload->>'envelope' = ${row.envelope} returning id`;
      return updated.length === 1;
    },
  },
  {
    name: "reading_sessions.encrypted_question",
    async load(sql, afterId) {
      return rows(
        await sql`
          select id, encrypted_question as envelope from reading_sessions
          where (${afterId}::uuid is null or id > ${afterId}::uuid)
          order by id limit ${BATCH_SIZE}`,
      );
    },
    async replace(sql, row, envelope) {
      const updated = await sql`
        update reading_sessions set encrypted_question = ${envelope}, updated_at = now()
        where id = ${row.id} and encrypted_question = ${row.envelope} returning id`;
      return updated.length === 1;
    },
  },
  {
    name: "follow_up_questions.encrypted_question",
    async load(sql, afterId) {
      return rows(
        await sql`
          select id, encrypted_question as envelope from follow_up_questions
          where (${afterId}::uuid is null or id > ${afterId}::uuid)
          order by id limit ${BATCH_SIZE}`,
      );
    },
    async replace(sql, row, envelope) {
      const updated = await sql`
        update follow_up_questions set encrypted_question = ${envelope}
        where id = ${row.id} and encrypted_question = ${row.envelope} returning id`;
      return updated.length === 1;
    },
  },
  {
    name: "reading_feedback.encrypted_comment",
    async load(sql, afterId) {
      return rows(
        await sql`
          select id, encrypted_comment as envelope from reading_feedback
          where encrypted_comment is not null
            and (${afterId}::uuid is null or id > ${afterId}::uuid)
          order by id limit ${BATCH_SIZE}`,
      );
    },
    async replace(sql, row, envelope) {
      const updated = await sql`
        update reading_feedback set encrypted_comment = ${envelope}
        where id = ${row.id} and encrypted_comment = ${row.envelope} returning id`;
      return updated.length === 1;
    },
  },
];

async function inspectTarget(
  sql: DatabaseClient,
  target: Target,
  rotationMode: RotationMode,
  current: string,
  previous: string[],
): Promise<RotationSummary> {
  const summary = { total: 0, current: 0, previous: 0, changed: 0 };
  let afterId: string | null = null;
  for (;;) {
    const batch = await target.load(sql, afterId);
    if (batch.length === 0) break;
    for (const row of batch) {
      summary.total += 1;
      let plaintext: string;
      try {
        plaintext = decryptSensitive(row.envelope, current);
        summary.current += 1;
      } catch {
        plaintext = decryptSensitiveWithKeys(row.envelope, previous);
        summary.previous += 1;
        if (rotationMode === "reencrypt") {
          const replaced = await target.replace(sql, row, encryptSensitive(plaintext, current));
          if (!replaced) throw new Error(`Concurrent update blocked ${target.name} rotation`);
          summary.changed += 1;
        }
      }
    }
    afterId = batch.at(-1)?.id ?? null;
  }
  return summary;
}

async function syntheticRehearsalSubjects(sql: DatabaseClient): Promise<string[]> {
  // The user tables are FORCE RLS, so an unscoped maintenance query correctly
  // sees no rows. Select only reserved-domain Auth identities, then bind each
  // subject through the same server actor role used by the application. Other
  // staging accounts may coexist, but this rehearsal never assumes their RLS
  // context and therefore cannot read or change their encrypted rows.
  const subjects = await sql<{ id: string }[]>`
    select id::text as id from auth.users
    where email like 'sg-verify-%@starguidance.test'
    order by id`;
  if (subjects.length === 0)
    throw new Error("Synthetic-only key rotation requires at least one synthetic Auth identity");
  return subjects.map(({ id }) => id);
}

async function main(): Promise<void> {
  const rotationMode = mode();
  const { current, previous } = keys();
  const sql = createDatabaseClient(required("DATABASE_URL"));
  let total = 0;
  let currentTotal = 0;
  let previousTotal = 0;
  let changedTotal = 0;
  const summaries = new Map<string, RotationSummary>(
    targets.map(({ name }) => [name, { total: 0, current: 0, previous: 0, changed: 0 }]),
  );

  const inspectAllTargets = async (client: DatabaseClient): Promise<void> => {
    for (const target of targets) {
      const summary = await inspectTarget(client, target, rotationMode, current, previous);
      const aggregate = summaries.get(target.name);
      if (!aggregate) throw new Error("Key rotation target inventory is inconsistent");
      aggregate.total += summary.total;
      aggregate.current += summary.current;
      aggregate.previous += summary.previous;
      aggregate.changed += summary.changed;
      total += summary.total;
      currentTotal += summary.current;
      previousTotal += summary.previous;
      changedTotal += summary.changed;
    }
  };

  try {
    if (process.env.KEY_ROTATION_SYNTHETIC_ONLY === "true") {
      const subjects = await syntheticRehearsalSubjects(sql);
      for (const subject of subjects)
        await sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${APPLICATION_DATABASE_ROLE}`);
          await tx`select set_config('request.jwt.claim.sub', ${subject}, true)`;
          const ownUser = await tx`select id from users where id = ${subject}::uuid`;
          if (ownUser.length !== 1)
            throw new Error("Synthetic Auth identity has no application user row");
          await inspectAllTargets(tx as unknown as DatabaseClient);
        });
    } else {
      await inspectAllTargets(sql);
    }

    for (const target of targets) {
      const summary = summaries.get(target.name);
      if (!summary) throw new Error("Key rotation target inventory is inconsistent");
      process.stdout.write(
        `${target.name}: ${summary.total} checked, ${summary.current} current, ` +
          `${summary.previous} previous, ${summary.changed} changed\n`,
      );
    }
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
  if (process.env.KEY_ROTATION_REQUIRE_ROWS === "true" && total === 0)
    throw new Error("Key rotation rehearsal found no encrypted rows and would be vacuous");
  if (process.env.KEY_ROTATION_REQUIRE_CHANGES === "true" && changedTotal === 0)
    throw new Error("Key rotation rehearsal changed no rows");
  if (rotationMode === "verify-current" && previousTotal > 0)
    throw new Error(`${previousTotal} encrypted row(s) still require a previous key`);
  process.stdout.write(
    `Key rotation: ${total} checked, ${currentTotal} current, ` +
      `${previousTotal} previous, ${changedTotal} changed.\n`,
  );
}

await main();
