import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeterministicFallbackProvider } from "@starguidance/ai";
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
import { clientFor, createPostgresRepositories } from "./postgres";

const databaseUrl = process.env.DATABASE_INTEGRATION_URL;
const describeDatabase = databaseUrl ? describe.sequential : describe.skip;

let sql: DatabaseClient | undefined;
let mode: SubjectMode = "plain";
const subjects: SyntheticSubject[] = [];
const profileId = randomUUID();
const snapshotId = randomUUID();

async function guestReading(owner: string): Promise<StoredReading> {
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
    followUp: {
      id: randomUUID(),
      encryptedQuestion: "2.guest-follow-up.encrypted",
      result: followUp.result,
      outputProvenance: followUp.provenance,
      createdAt: new Date().toISOString(),
    },
  });
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
});
