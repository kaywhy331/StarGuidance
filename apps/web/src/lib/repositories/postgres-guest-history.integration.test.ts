import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeterministicFallbackProvider } from "@starguidance/ai";
import { APPLICATION_DATABASE_ROLE, createDatabaseClient } from "@starguidance/database";
import type { DatabaseClient, StoredReading } from "@starguidance/database";
import {
  createSubject,
  deleteSubject,
  detectSubjectMode,
  type SubjectMode,
  type SyntheticSubject,
} from "@starguidance/database/test-support/synthetic-subjects";
import { DECK_VERSION, spreads, tarotCards } from "@starguidance/tarot-content";
import { createLockedDraw } from "@starguidance/tarot-domain";

import { storedGuestReading } from "../guest-reading-server";
import {
  disposableFixtureRefusal,
  type DisposableFixtureEvidence,
} from "./disposable-postgres-fixture";
import { clientFor, createPostgresRepositories } from "./postgres";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const describeDatabase = databaseUrl ? describe.sequential : describe.skip;
const disposableFixtureManifest = process.env.STARGUIDANCE_DISPOSABLE_POSTGRES_FIXTURE;
const itOnDisposableFixture = disposableFixtureManifest ? it : it.skip;

let sql: DatabaseClient | undefined;
let mode: SubjectMode = "plain";
const subjects: SyntheticSubject[] = [];
const profileId = randomUUID();
const snapshotId = randomUUID();

async function guestReading(
  owner: string,
  options: { withFollowUp?: boolean } = {},
): Promise<StoredReading> {
  const spread = spreads.find(({ id }) => id === "three-card")!;
  const configuration = {
    version: "reading-configuration-v1" as const,
    reversalMode: "reversals_enabled" as const,
    personalizationMode: "personalized_tarot" as const,
    positions: spread.positions,
    capabilities: spread.capabilities!,
  };
  const draw = createLockedDraw({ cards: tarotCards, deckVersion: DECK_VERSION, spread });
  const question = "What deserves my attention in my work?";
  const questionClassification = {
    version: "question-classification-v1" as const,
    topic: "career" as const,
    horizon: "open" as const,
    intent: "clarity" as const,
    generalReading: false,
  };
  const readerLens = ["You tend to trust what you can build steadily."];
  const provider = new DeterministicFallbackProvider();
  const generated = await provider.generateWithProvenance({
    draw,
    configuration,
    question,
    questionClassification,
    relevantTraitStatements: readerLens,
  });
  const followUp = await provider.generateFollowUpWithProvenance({
    draw,
    configuration,
    question: "What is one practical step for my work?",
    questionClassification,
    relevantTraitStatements: readerLens,
    originalResult: generated.result,
  });
  return storedGuestReading({
    userId: owner,
    receipt: {
      version: "guest-reading-receipt-v2",
      readingId: draw.id,
      question,
      questionClassification,
      configuration,
      readerLens,
      draw,
      result: generated.result,
      provenance: generated.provenance,
      createdAt: draw.lockedAt,
      expiresAt: new Date(Date.parse(draw.lockedAt) + 7 * 86_400_000).toISOString(),
    },
    encryptedQuestion: "2.guest-question.encrypted",
    safetyClassification: "ordinary",
    followUp:
      options.withFollowUp === false
        ? undefined
        : {
            id: randomUUID(),
            encryptedQuestion: "2.guest-follow-up.encrypted",
            result: followUp.result,
            outputProvenance: followUp.provenance,
            createdAt: new Date().toISOString(),
          },
  });
}

/** A follow-up for an already saved guest reading, as the save route attaches one. */
async function lateFollowUp(owner: string): Promise<StoredReading["followUps"][number]> {
  const [followUp] = (await guestReading(owner)).followUps;
  return { ...followUp!, id: randomUUID() };
}

describeDatabase("Postgres saved guest readings", () => {
  beforeAll(async () => {
    if (!databaseUrl) return;
    sql = clientFor(databaseUrl);
    mode = await detectSubjectMode(sql);
    for (const label of ["guest-history-a", "guest-history-b"]) {
      const subject = await createSubject(sql, mode, label);
      subjects.push(subject);
      await sql`insert into users (id, email) values (${subject.id}, ${subject.email})`;
    }
    const owner = subjects[0]!.id;
    await sql.begin(async (tx) => {
      await tx`insert into birth_profiles (id, user_id, encrypted_payload) values
        (${profileId}, ${owner}, '2.profile.encrypted')`;
      await tx`insert into profile_snapshots
        (id, user_id, profile_id, version, completeness, derived_payload, calculation_versions) values
        (${snapshotId}, ${owner}, ${profileId}, 1, 'core',
         ${tx.json({ snapshot: { id: snapshotId } })}, ${tx.json({ numerology: "v1" })})`;
    });
  });

  afterAll(async () => {
    if (!sql || !databaseUrl) return;
    for (const subject of subjects) {
      await sql`delete from users where id = ${subject.id}`.catch(() => undefined);
      await deleteSubject(sql, mode, subject).catch(() => undefined);
    }
    await sql.end({ timeout: 5 }).catch(() => undefined);
    (
      globalThis as typeof globalThis & {
        __starGuidancePostgresClients?: Map<string, DatabaseClient>;
      }
    ).__starGuidancePostgresClients?.delete(databaseUrl);
  });

  itOnDisposableFixture(
    "returns the owner's exact reading after a deterministic primary-key conflict",
    async () => {
      if (!sql || !databaseUrl || !disposableFixtureManifest)
        throw new Error("private fixture required");
      const owner = subjects[0]!.id;
      const reading = await guestReading(owner);
      const repositories = createPostgresRepositories({ databaseUrl, actorUserId: owner });
      const originalKey = `forced-primary-key:${randomUUID()}`;
      const saved = await repositories.readingSessions.importGuestReading({
        ...reading,
        idempotencyKey: originalKey,
      });
      // The requested key cannot take either idempotency shortcut. The existing
      // id forces reading_sessions_pkey on every attempt, independent of timing.
      expect(
        await repositories.readingSessions.getByIdempotencyKey(owner, reading.idempotencyKey),
      ).toBeUndefined();
      const [before] =
        await sql`select id, idempotency_key from reading_sessions where id=${reading.id}`;
      expect(before).toMatchObject({ id: reading.id, idempotency_key: originalKey });
      const replay = await repositories.readingSessions.importGuestReading(reading);
      expect(replay).toEqual(saved);
      expect(replay.draw).toEqual(reading.draw);
      expect(replay.result).toEqual(reading.result);
      const [counts] = await sql`
      select (select count(*)::int from reading_sessions where id=${reading.id}) as sessions,
        (select count(*)::int from reading_draws where reading_id=${reading.id}) as draws,
        (select count(*)::int from reading_outputs where reading_id=${reading.id}) as outputs,
        (select count(*)::int from follow_up_questions where reading_id=${reading.id}) as followups,
        (select count(*)::int from interpretation_jobs where reading_id=${reading.id}) as jobs
    `;
      expect(counts).toEqual({ sessions: 1, draws: 1, outputs: 1, followups: 1, jobs: 0 });
      console.log(
        JSON.stringify({
          gate: "deterministic-primary-key",
          sameOwner: true,
          requestedKeyAbsent: true,
          counts,
        }),
      );
    },
  );

  itOnDisposableFixture(
    "denies another owner after a deterministic primary-key conflict",
    async () => {
      if (!databaseUrl || !disposableFixtureManifest) throw new Error("private fixture required");
      const [owner, other] = [subjects[0]!.id, subjects[1]!.id];
      const reading = await guestReading(owner);
      const saved = await createPostgresRepositories({
        databaseUrl,
        actorUserId: owner,
      }).readingSessions.importGuestReading({
        ...reading,
        idempotencyKey: `forced-primary-key:${randomUUID()}`,
      });
      const foreign = createPostgresRepositories({ databaseUrl, actorUserId: other });
      await expect(
        foreign.readingSessions.importGuestReading({ ...reading, userId: other }),
      ).rejects.toThrow("GUEST_READING_SAVED_ELSEWHERE");
      expect(await foreign.readingSessions.get(other, reading.id)).toBeUndefined();
      expect(
        await foreign.readingSessions.getByIdempotencyKey(other, saved.idempotencyKey),
      ).toBeUndefined();
      expect(
        await createPostgresRepositories({ databaseUrl, actorUserId: owner }).readingSessions.get(
          owner,
          reading.id,
        ),
      ).toEqual(saved);
      console.log(
        JSON.stringify({
          gate: "deterministic-primary-key",
          crossOwnerDenied: true,
          foreignReadingInvisible: true,
        }),
      );
    },
  );

  it("saves the exact draw, interpretation, and follow-up once, with no job or allowance", async () => {
    if (!sql || !databaseUrl) throw new Error("DATABASE_INTEGRATION_URL is required");
    const owner = subjects[0]!.id;
    const repositories = createPostgresRepositories({ databaseUrl, actorUserId: owner });
    const reading = await guestReading(owner);

    const saved = await repositories.readingSessions.importGuestReading(reading);
    const replay = await repositories.readingSessions.importGuestReading({
      ...reading,
      followUps: [],
    });

    expect(saved).toMatchObject({
      id: reading.id,
      source: "guest_trial",
      profileSnapshotId: null,
      idempotencyKey: `guest-trial:${reading.id}`,
      generationStatus: "ready",
      readingLens: { version: "guest-date-lens-v1", statements: reading.readingLens.statements },
      entitlementDecision: { mode: "guest-trial", outcome: "granted" },
      ritualProgress: { phase: "complete", revealedIndexes: [0, 1, 2] },
      createdAt: reading.createdAt,
    });
    expect(saved.draw).toEqual(reading.draw);
    expect(saved.result).toEqual(reading.result);
    expect(saved.outputProvenance).toMatchObject({ providerId: "deterministic-fallback-v1" });
    expect(saved.followUps.map(({ result }) => result)).toEqual(
      reading.followUps.map(({ result }) => result),
    );
    expect(saved.encryptedServerSeed).toBeUndefined();
    expect(replay).toEqual(saved);
    expect(
      await repositories.readingSessions.getByIdempotencyKey(owner, reading.idempotencyKey),
    ).toEqual(saved);

    const [rows] = await sql<
      { sessions: number; outputs: number; follow_ups: number; jobs: number; seeds: number }[]
    >`
      select
        (select count(*)::int from reading_sessions where id = ${reading.id}) as sessions,
        (select count(*)::int from reading_outputs where reading_id = ${reading.id}) as outputs,
        (select count(*)::int from follow_up_questions where reading_id = ${reading.id})
          as follow_ups,
        (select count(*)::int from interpretation_jobs where reading_id = ${reading.id}) as jobs,
        (select count(*)::int from reading_draws
          where reading_id = ${reading.id} and encrypted_server_seed is not null) as seeds
    `;
    expect(rows).toEqual({ sessions: 1, outputs: 1, follow_ups: 1, jobs: 0, seeds: 0 });
  });

  it("keeps one free reading in one history and hides it from other accounts", async () => {
    if (!databaseUrl) throw new Error("DATABASE_INTEGRATION_URL is required");
    const [owner, other] = [subjects[0]!.id, subjects[1]!.id];
    const reading = await guestReading(owner);
    await createPostgresRepositories({
      databaseUrl,
      actorUserId: owner,
    }).readingSessions.importGuestReading(reading);
    const otherRepositories = createPostgresRepositories({ databaseUrl, actorUserId: other });

    await expect(
      otherRepositories.readingSessions.importGuestReading({ ...reading, userId: other }),
    ).rejects.toThrow("GUEST_READING_SAVED_ELSEWHERE");
    expect(await otherRepositories.readingSessions.get(other, reading.id)).toBeUndefined();
    expect(
      await otherRepositories.readingSessions.getByIdempotencyKey(other, reading.idempotencyKey),
    ).toBeUndefined();
  });

  it("refuses rows that mix an account snapshot with a guest source", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    const owner = subjects[0]!.id;
    const base = await guestReading(owner);
    const insert = (source: string, snapshot: string | null) =>
      sql!`
        insert into reading_sessions (
          id, user_id, profile_snapshot_id, source, spread_id, spread_version, idempotency_key,
          encrypted_question, reading_lens, safety_classification, state
        ) values (
          ${randomUUID()}, ${owner}, ${snapshot}, ${source}, ${base.spreadId},
          ${base.draw.spreadVersion}, ${randomUUID()}, '2.question', ${sql!.json({})},
          'ordinary', 'ready'
        )
      `;

    await expect(insert("account", null)).rejects.toMatchObject({ code: "23514" });
    await expect(insert("guest_trial", snapshotId)).rejects.toMatchObject({ code: "23514" });
    await expect(insert("imported", null)).rejects.toMatchObject({ code: "23514" });
  });

  it("lets exactly one of several competing attaches add the follow-up to a saved reading", async () => {
    if (!sql || !databaseUrl) throw new Error("DATABASE_INTEGRATION_URL is required");
    const owner = subjects[0]!.id;
    const repositories = createPostgresRepositories({ databaseUrl, actorUserId: owner });
    const reading = await guestReading(owner, { withFollowUp: false });
    const saved = await repositories.readingSessions.importGuestReading(reading);
    expect(saved.followUps).toEqual([]);

    // Competing transactions: each one reads the count under the row lock.
    const competitors = await Promise.allSettled(
      Array.from({ length: 5 }, async () =>
        repositories.followUps.create(owner, reading.id, await lateFollowUp(owner), { limit: 1 }),
      ),
    );

    expect(competitors.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const refused = competitors.filter(
      (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected",
    );
    expect(refused).toHaveLength(4);
    for (const { reason } of refused)
      expect((reason as Error).message).toBe("FOLLOW_UP_LIMIT_REACHED");
    const [persisted] = await sql<{ count: number }[]>`
      select count(*)::int as count from follow_up_questions where reading_id = ${reading.id}
    `;
    expect(persisted?.count).toBe(1);
    expect((await repositories.readingSessions.get(owner, reading.id))?.followUps).toHaveLength(1);
  });

  it("makes a second attach wait on the saved reading's row lock rather than racing past it", async () => {
    if (!sql || !databaseUrl) throw new Error("DATABASE_INTEGRATION_URL is required");
    const database = sql;
    const owner = subjects[0]!.id;
    const repositories = createPostgresRepositories({ databaseUrl, actorUserId: owner });
    const reading = await guestReading(owner, { withFollowUp: false });
    await repositories.readingSessions.importGuestReading(reading);

    let holding!: () => void;
    const holdingLock = new Promise<void>((resolve) => (holding = resolve));
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let holderPid = 0;
    const lockHolder = database.begin(async (tx) => {
      const [backend] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      holderPid = backend?.pid ?? 0;
      await tx`select id from reading_sessions where id = ${reading.id} for update`;
      holding();
      await released;
    });
    let attach: Promise<void> | undefined;
    let settled: PromiseSettledResult<unknown>[] = [];
    try {
      // A holder that fails before locking rejects here instead of hanging.
      await Promise.race([holdingLock, lockHolder]);
      attach = repositories.followUps.create(owner, reading.id, await lateFollowUp(owner), {
        limit: 1,
      });
      attach.catch(() => undefined); // settled and inspected in finally
      // Only a backend of this database that this holder's lock is blocking counts.
      let blocked = 0;
      for (let attempt = 0; attempt < 50 && blocked === 0; attempt += 1) {
        const [waiting] = await database<{ blocked: number }[]>`
          select count(*)::int as blocked from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'
            and ${holderPid}::int = any(pg_blocking_pids(pid))
        `;
        blocked = waiting?.blocked ?? 0;
        if (blocked === 0) await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(blocked).toBe(1);
      const [before] = await database<{ before: number }[]>`
        select count(*)::int as before from follow_up_questions where reading_id = ${reading.id}
      `;
      expect(before?.before).toBe(0);
    } finally {
      // Always let go of the lock and settle both sides; a failure above is
      // still the error the test reports.
      release();
      settled = await Promise.allSettled(attach ? [lockHolder, attach] : [lockHolder]);
    }
    expect(settled.map(({ status }) => status)).toEqual(["fulfilled", "fulfilled"]);
    const [after] = await database<{ after: number }[]>`
      select count(*)::int as after from follow_up_questions where reading_id = ${reading.id}
    `;
    expect(after?.after).toBe(1);
  });

  it("enforces forced row-level security for the application role in raw SQL", async () => {
    if (!sql) throw new Error("DATABASE_INTEGRATION_URL is required");
    const database = sql;
    const [owner, other] = [subjects[0]!.id, subjects[1]!.id];
    const reading = await guestReading(owner);
    await createPostgresRepositories({
      databaseUrl: databaseUrl!,
      actorUserId: owner,
    }).readingSessions.importGuestReading(reading);
    const followUpId = reading.followUps[0]!.id;

    const [role] = await database<{ rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolsuper, rolbypassrls from pg_roles where rolname = ${APPLICATION_DATABASE_ROLE}
    `;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    const forced = await database<{ relname: string; on: boolean; force: boolean }[]>`
      select relname, relrowsecurity as on, relforcerowsecurity as force from pg_class
      where relname in ('reading_sessions', 'reading_draws', 'reading_outputs', 'follow_up_questions')
      order by relname
    `;
    expect(forced.map(({ relname, on, force }) => [relname, on, force])).toEqual([
      ["follow_up_questions", true, true],
      ["reading_draws", true, true],
      ["reading_outputs", true, true],
      ["reading_sessions", true, true],
    ]);

    // Raw SQL with no user_id predicate: only the policy decides what is seen.
    const asSubject = async <T>(
      subject: string,
      work: (tx: Parameters<Parameters<typeof database.begin>[1]>[0]) => Promise<T>,
    ) =>
      database.begin(async (tx) => {
        await tx.unsafe(`set local role ${APPLICATION_DATABASE_ROLE}`);
        await tx`select set_config('request.jwt.claim.sub', ${subject}, true)`;
        return work(tx);
      });
    const visible = (subject: string) =>
      asSubject(subject, async (tx) => {
        const [row] = await tx<{ sessions: number; followUps: number; draws: number }[]>`
          select
            (select count(*)::int from reading_sessions where id = ${reading.id}) as sessions,
            (select count(*)::int from follow_up_questions where id = ${followUpId}) as "followUps",
            (select count(*)::int from reading_draws where reading_id = ${reading.id}) as draws
        `;
        return row;
      });
    expect(await visible(owner)).toEqual({ sessions: 1, followUps: 1, draws: 1 });
    expect(await visible(other)).toEqual({ sessions: 0, followUps: 0, draws: 0 });

    // The other account's writes touch nothing or are refused outright.
    const touched = await asSubject(other, async (tx) => {
      const updated = await tx`
        update reading_sessions set safety_classification = 'tampered' where id = ${reading.id}
      `;
      const deleted = await tx`delete from reading_sessions where id = ${reading.id}`;
      const deletedFollowUp = await tx`delete from follow_up_questions where id = ${followUpId}`;
      return [updated.count, deleted.count, deletedFollowUp.count];
    });
    expect(touched).toEqual([0, 0, 0]);
    await expect(
      asSubject(
        other,
        (tx) => tx`
        insert into follow_up_questions (
          id, user_id, reading_id, encrypted_question, output, provider_id, prompt_version,
          content_version, safety_policy_version, schema_version
        ) values (
          ${randomUUID()}, ${owner}, ${reading.id}, '2.forged', ${tx.json({})}, 'x', 'x', 'x', 'x', 'x'
        )
      `,
      ),
    ).rejects.toMatchObject({ code: "42501" });
    // Forced RLS only constrains the row's own user_id, and the foreign key to
    // reading_sessions is checked without RLS. The (reading_id, user_id) key is
    // what stops another account pointing a follow-up of its own at this reading.
    const ownerKey = { code: "23503", constraint_name: "follow_up_questions_reading_owner_fk" };
    await expect(
      asSubject(
        other,
        (tx) => tx`
        insert into follow_up_questions (
          id, user_id, reading_id, encrypted_question, output, provider_id, prompt_version,
          content_version, safety_policy_version, schema_version
        ) values (
          ${randomUUID()}, ${other}, ${reading.id}, '2.cross-account', ${tx.json({})},
          'x', 'x', 'x', 'x', 'x'
        )
      `,
      ),
    ).rejects.toMatchObject(ownerKey);
    // Nor can it re-point a follow-up it legitimately owns.
    const otherReading = await guestReading(other);
    await createPostgresRepositories({
      databaseUrl: databaseUrl!,
      actorUserId: other,
    }).readingSessions.importGuestReading(otherReading);
    const otherFollowUpId = otherReading.followUps[0]!.id;
    await expect(
      asSubject(
        other,
        (tx) => tx`
        update follow_up_questions set reading_id = ${reading.id} where id = ${otherFollowUpId}
      `,
      ),
    ).rejects.toMatchObject(ownerKey);
    const [otherFollowUp] = await database<{ readingId: string }[]>`
      select reading_id as "readingId" from follow_up_questions where id = ${otherFollowUpId}
    `;
    expect(otherFollowUp?.readingId).toBe(otherReading.id);
    expect(await visible(owner)).toEqual({ sessions: 1, followUps: 1, draws: 1 });
    expect(
      (
        await createPostgresRepositories({
          databaseUrl: databaseUrl!,
          actorUserId: owner,
        }).readingSessions.get(owner, reading.id)
      )?.followUps,
    ).toHaveLength(1);

    // The superuser view confirms nothing else changed.
    const [state] = await database<{ safety: string; followUps: number }[]>`
      select
        (select safety_classification from reading_sessions where id = ${reading.id}) as safety,
        (select count(*)::int from follow_up_questions where reading_id = ${reading.id})
          as "followUps"
    `;
    expect(state).toEqual({ safety: "ordinary", followUps: 1 });
  });

  // This rehearsal commits a temporary DROP of a database-wide constraint, so it
  // runs only when deliberately pointed at a disposable cluster manifest, and
  // then only after that cluster is proven to be the connected server. It is
  // reported as skipped (never passed) otherwise. Invoke it with
  // `python3 .task-evidence/run-ownership-postgres.py corepack pnpm --filter
  // @starguidance/web exec vitest run <this file>`, which supplies the manifest.
  itOnDisposableFixture(
    "adds the follow-up owner key over legacy cross-account rows without touching them (0028)",
    async () => {
      if (!sql || !databaseUrl) throw new Error("DATABASE_INTEGRATION_URL is required");
      const database = sql;
      // Fail closed before any DDL unless every isolation fact agrees.
      const manifest = JSON.parse(readFileSync(disposableFixtureManifest!, "utf8")) as unknown;
      const [server] = await database<DisposableFixtureEvidence["server"][]>`
      select current_setting('data_directory') as "dataDirectory",
        current_setting('listen_addresses') as "listenAddresses",
        host(inet_client_addr()) as "clientAddress",
        current_setting('port')::int as port,
        current_setting('unix_socket_directories') as "socketDirectories",
        current_database() as database
    `;
      let postmasterPidLines: string[] | undefined;
      try {
        postmasterPidLines = readFileSync(`${server!.dataDirectory}/postmaster.pid`, "utf8").split(
          "\n",
        );
      } catch {
        postmasterPidLines = undefined;
      }
      expect(disposableFixtureRefusal({ manifest, server: server!, postmasterPidLines })).toBe(
        undefined,
      );
      const [owner, other] = [subjects[0]!.id, subjects[1]!.id];
      const reading = await guestReading(owner);
      await createPostgresRepositories({
        databaseUrl,
        actorUserId: owner,
      }).readingSessions.importGuestReading(reading);
      const ownerKey = { code: "23503", constraint_name: "follow_up_questions_reading_owner_fk" };
      const [addOwnerKey] = readFileSync(
        fileURLToPath(
          new URL(
            "../../../../../packages/database/migrations/0028_follow_up_reading_owner.sql",
            import.meta.url,
          ),
        ),
        "utf8",
      )
        .split("--> statement-breakpoint")
        .filter((statement) => statement.includes("follow_up_questions_reading_owner_fk"));
      expect(addOwnerKey).toMatch(/not valid;?\s*$/i);

      const [applied] = await database<{ validated: boolean }[]>`
      select convalidated as validated from pg_constraint
      where conname = 'follow_up_questions_reading_owner_fk'
    `;
      expect(applied).toEqual({ validated: false });

      // Recreate history as it stood before 0028: a committed cross-account row.
      // It must be committed first, because the engine re-checks any row inserted
      // by the current transaction even when its keys do not change.
      const legacyId = randomUUID();
      const legacyRows = async () =>
        (
          await database<{ count: number }[]>`
          select count(*)::int as count from follow_up_questions where id = ${legacyId}
        `
        )[0]?.count;
      const ownerKeyPresent = async () =>
        (
          await database<{ count: number }[]>`
          select count(*)::int as count from pg_constraint
          where conname = 'follow_up_questions_reading_owner_fk'
        `
        )[0]?.count === 1;
      await database.begin(async (tx) => {
        await tx`alter table follow_up_questions drop constraint follow_up_questions_reading_owner_fk`;
        await tx`
        insert into follow_up_questions (id, user_id, reading_id, encrypted_question, output)
        values (${legacyId}, ${other}, ${reading.id}, '2.legacy-cross-account', ${tx.json({})})
      `;
      });
      try {
        // The migration's own statement applies over the legacy row.
        await database.unsafe(addOwnerKey!);
        expect(await legacyRows()).toBe(1);

        const asOther = <T>(work: (tx: Parameters<Parameters<typeof database.begin>[1]>[0]) => T) =>
          database.begin(async (tx) => {
            await tx.unsafe(`set local role ${APPLICATION_DATABASE_ROLE}`);
            await tx`select set_config('request.jwt.claim.sub', ${other}, true)`;
            return work(tx);
          });
        // New cross-account rows are refused while the legacy row stays usable.
        await expect(
          asOther(
            (tx) => tx`
          insert into follow_up_questions (id, user_id, reading_id, encrypted_question, output)
          values (${randomUUID()}, ${other}, ${reading.id}, '2.cross-account', ${tx.json({})})
        `,
          ),
        ).rejects.toMatchObject(ownerKey);
        const touched = await asOther(
          (tx) => tx`
        update follow_up_questions set encrypted_question = '2.legacy-touched'
        where id = ${legacyId}
      `,
        );
        expect(touched.count).toBe(1);

        // Validation is what would expose the row: it fails and changes nothing.
        await expect(
          database`alter table follow_up_questions validate constraint follow_up_questions_reading_owner_fk`,
        ).rejects.toMatchObject(ownerKey);
        expect(await legacyRows()).toBe(1);
        expect(
          (
            await createPostgresRepositories({
              databaseUrl,
              actorUserId: owner,
            }).readingSessions.get(owner, reading.id)
          )?.followUps,
        ).toHaveLength(1);

        // Rolling 0028 back is two drops; no row is rewritten or removed.
        const rollback = new Error("roll back the rollback rehearsal");
        await expect(
          database.begin(async (tx) => {
            await tx`alter table follow_up_questions drop constraint follow_up_questions_reading_owner_fk`;
            await tx`alter table reading_sessions drop constraint reading_sessions_id_user_unique`;
            const [kept] = await tx<{ count: number }[]>`
            select count(*)::int as count from follow_up_questions where id = ${legacyId}
          `;
            expect(kept?.count).toBe(1);
            throw rollback;
          }),
        ).rejects.toBe(rollback);
      } finally {
        // Remove only the synthetic row and leave the schema as 0028 made it.
        await database`delete from follow_up_questions where id = ${legacyId}`;
        if (!(await ownerKeyPresent())) await database.unsafe(addOwnerKey!);
      }
      const [after] = await database<{ keys: number; validated: boolean }[]>`
      select
        (select count(*)::int from pg_constraint where conname in
          ('follow_up_questions_reading_owner_fk', 'reading_sessions_id_user_unique')) as keys,
        (select bool_and(convalidated) from pg_constraint
          where conname = 'follow_up_questions_reading_owner_fk') as validated
    `;
      expect(after).toEqual({ keys: 2, validated: false });
    },
  );

  it("deletes readings made with the profile but keeps the saved guest reading", async () => {
    if (!sql || !databaseUrl) throw new Error("DATABASE_INTEGRATION_URL is required");
    const owner = subjects[0]!.id;
    const repositories = createPostgresRepositories({ databaseUrl, actorUserId: owner });
    const accountReadingId = randomUUID();
    const three = spreads.find(({ id }) => id === "three-card")!;
    await sql`
      insert into reading_sessions (
        id, user_id, profile_snapshot_id, spread_id, spread_version, idempotency_key,
        encrypted_question, reading_lens, safety_classification, state
      ) values (
        ${accountReadingId}, ${owner}, ${snapshotId}, ${three.id}, ${three.version},
        ${randomUUID()}, '2.question', ${sql.json({})}, 'ordinary', 'ready'
      )
    `;
    const guestIds = (
      await sql<{ id: string }[]>`
        select id from reading_sessions where user_id = ${owner} and source = 'guest_trial'
      `
    ).map(({ id }) => id);
    expect(guestIds.length).toBeGreaterThan(0);

    expect(await repositories.birthProfiles.delete(owner)).toBe(true);

    const remaining = await sql<{ id: string; source: string }[]>`
      select id, source from reading_sessions where user_id = ${owner}
    `;
    expect(remaining.map(({ id }) => id).sort()).toEqual([...guestIds].sort());
    expect(remaining.every(({ source }) => source === "guest_trial")).toBe(true);
    expect(remaining.some(({ id }) => id === accountReadingId)).toBe(false);
  });

  /** Holds a table lock so every attempt is provably parked at its insert
   * (seen by a separate observer connection) before any is allowed to proceed. */
  async function overlapFirstSaves(readings: StoredReading[]) {
    if (!sql || !databaseUrl) throw new Error("private fixture required");
    const database = sql;
    let unlock!: () => void;
    let locked!: () => void;
    const release = new Promise<void>((resolve) => (unlock = resolve));
    const acquired = new Promise<void>((resolve) => (locked = resolve));
    let pid = 0;
    const holder = database.begin(async (tx) => {
      const [backend] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid`;
      pid = backend!.pid;
      await tx`lock table reading_sessions in share row exclusive mode`;
      locked();
      await release;
    });
    let attempts: Promise<StoredReading>[] = [];
    try {
      await Promise.race([acquired, holder]);
      attempts = readings.map((reading) =>
        createPostgresRepositories({
          databaseUrl,
          actorUserId: reading.userId,
        }).readingSessions.importGuestReading(reading),
      );
      for (const attempt of attempts) void attempt.catch(() => undefined);
      // The repository pool has only three slots, so observe from another client.
      const observer = createDatabaseClient(databaseUrl, { max: 1 });
      try {
        let blocked = 0;
        for (let index = 0; index < 50 && blocked < 2; index += 1) {
          const [row] = await observer<{ blocked: number }[]>`
            select count(*)::int as blocked from pg_stat_activity
            where datname = current_database() and wait_event_type = 'Lock'
              and ${pid}::int = any(pg_blocking_pids(pid))
          `;
          blocked = row!.blocked;
          if (blocked < 2) await new Promise((resolve) => setTimeout(resolve, 40));
        }
        expect(blocked).toBeGreaterThanOrEqual(2);
      } finally {
        await observer.end({ timeout: 5 });
      }
    } finally {
      unlock();
      await holder;
    }
    return Promise.allSettled(attempts);
  }

  it("returns the same reading to overlapping first saves by one owner", async () => {
    if (!sql || !databaseUrl) throw new Error("DATABASE_INTEGRATION_URL is required");
    const owner = subjects[0]!.id;
    for (let round = 0; round < 3; round += 1) {
      const reading = await guestReading(owner);
      const outcomes = await overlapFirstSaves(Array.from({ length: 5 }, () => reading));
      expect(outcomes.map((item) => item.status)).toEqual(Array(5).fill("fulfilled"));
      for (const item of outcomes) {
        if (item.status !== "fulfilled") continue;
        expect(item.value.id).toBe(reading.id);
        expect(item.value.draw).toEqual(reading.draw);
        expect(item.value.result).toEqual(reading.result);
        expect(item.value.followUps).toHaveLength(1);
      }
      const [rows] = await sql<
        { sessions: number; draws: number; outputs: number; followups: number }[]
      >`
        select
          (select count(*)::int from reading_sessions where id = ${reading.id}) as sessions,
          (select count(*)::int from reading_draws where reading_id = ${reading.id}) as draws,
          (select count(*)::int from reading_outputs where reading_id = ${reading.id}) as outputs,
          (select count(*)::int from follow_up_questions where reading_id = ${reading.id}) as followups
      `;
      expect(rows).toEqual({ sessions: 1, draws: 1, outputs: 1, followups: 1 });
    }
  });

  it("lets exactly one owner win overlapping first saves of the same reading", async () => {
    if (!sql || !databaseUrl) throw new Error("DATABASE_INTEGRATION_URL is required");
    const reading = await guestReading(subjects[0]!.id, { withFollowUp: false });
    const outcomes = await overlapFirstSaves([reading, { ...reading, userId: subjects[1]!.id }]);
    expect(outcomes.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(
      outcomes.filter((item) => item.status === "rejected").map((item) => item.reason.message),
    ).toEqual(["GUEST_READING_SAVED_ELSEWHERE"]);
    const winner = subjects[outcomes.findIndex((item) => item.status === "fulfilled")]!.id;
    const loser = subjects.find(({ id }) => id !== winner)!.id;
    const [row] = await sql<{ count: number; owner: string }[]>`
      select count(*)::int as count, min(user_id::text) as owner
      from reading_sessions where id = ${reading.id}
    `;
    expect(row).toEqual({ count: 1, owner: winner });
    expect(
      await createPostgresRepositories({ databaseUrl, actorUserId: loser }).readingSessions.get(
        loser,
        reading.id,
      ),
    ).toBeUndefined();
  });
});
