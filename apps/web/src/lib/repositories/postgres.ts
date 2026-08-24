import "server-only";

import { randomUUID } from "node:crypto";

import {
  followUpResultSchema,
  normalizeFollowUpResult,
  profileSnapshotSchema,
  profileTraitSchema,
  questionClassificationSchema,
  readingConfigurationSchema,
  readingEntitlementDecisionSchema,
  readingOutputProvenanceSchema,
  readingResultSchema,
  ritualProgressSchema,
  type ProfileSnapshot,
  type ReadingOutputProvenance,
  type ReadingResult,
  type StoredRitualProgress,
} from "@starguidance/contracts";
import type {
  ApplicationRepositories,
  AuditRecord,
  ConsentRecord,
  ProfileComponentRecord,
  ProfileTraitRecord,
  RepositoryUser,
  StoredEntitlement,
  StoredFeedback,
  StoredFollowUp,
  StoredOrder,
  StoredProfileVersion,
  StoredReading,
  StoredReport,
  UserSettingsRecord,
  DatabaseClient,
  DatabaseJsonValue,
  DatabaseRow,
  DatabaseTransaction,
} from "@starguidance/database";
import {
  APPLICATION_DATABASE_ROLE,
  createDatabaseClient,
  insertInterpretationJob,
} from "@starguidance/database";
import { findSpread, TAROT_CONTENT_VERSION } from "@starguidance/tarot-content";
import type { LockedDraw } from "@starguidance/tarot-domain";

import { profileDerivedPayload } from "./profile-storage";

type Transaction = DatabaseTransaction;
type JsonObject = Record<string, unknown>;

interface PostgresRepositoryOptions {
  databaseUrl: string;
  actorUserId?: string;
  serviceRole?: boolean;
}

const globalDatabase = globalThis as typeof globalThis & {
  __starGuidancePostgresClients?: Map<string, DatabaseClient>;
};

/**
 * Shared across every caller keyed by databaseUrl — including callers
 * outside this file, e.g. the system-only rate-limit transaction in
 * ../request-security.ts — so they reuse this process's one bounded
 * connection pool per URL instead of each opening their own.
 */
export function clientFor(databaseUrl: string): DatabaseClient {
  const clients = (globalDatabase.__starGuidancePostgresClients ??= new Map());
  const existing = clients.get(databaseUrl);
  if (existing) return existing;
  // Every Netlify route can live in a separate serverless process, so keep the
  // per-process pool bounded and return capacity promptly. Three connections
  // still let first-request provisioning run its independent profile/settings/
  // consent reads in parallel without exceeding Netlify's request deadline;
  // the deployment contract requires a transaction-pooler URL to multiplex
  // these short-lived clients safely.
  const client = createDatabaseClient(databaseUrl, { max: 3, idleTimeoutSeconds: 5 });
  clients.set(databaseUrl, client);
  return client;
}

function json(value: unknown): DatabaseJsonValue {
  return JSON.parse(JSON.stringify(value)) as DatabaseJsonValue;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function profileFromRow(row: DatabaseRow): StoredProfileVersion {
  const payload = row.derived_payload as JsonObject;
  return {
    encryptedInput: String(row.encrypted_input),
    encryptedCalculations: String(row.encrypted_calculations),
    snapshot: profileSnapshotSchema.parse(payload.snapshot),
  };
}

function orderFromRow(row: DatabaseRow): StoredOrder {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    snapshotId: row.profile_snapshot_id ? String(row.profile_snapshot_id) : null,
    provider: row.provider as StoredOrder["provider"],
    providerSessionId: String(row.provider_session_id),
    idempotencyKey: String(row.idempotency_key),
    status: row.status as StoredOrder["status"],
    createdAt: iso(row.created_at as Date),
  };
}

function entitlementFromRow(row: DatabaseRow): StoredEntitlement {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    snapshotId: row.profile_snapshot_id ? String(row.profile_snapshot_id) : null,
    orderId: String(row.order_id),
    status: row.status as StoredEntitlement["status"],
    createdAt: iso(row.created_at as Date),
  };
}

function reportFromRows(report: DatabaseRow, sections: readonly DatabaseRow[]): StoredReport {
  return {
    id: String(report.id),
    userId: String(report.user_id),
    snapshotId: report.profile_snapshot_id ? String(report.profile_snapshot_id) : null,
    orderId: String(report.order_id),
    provider: report.provider as StoredReport["provider"],
    status: report.status as StoredReport["status"],
    createdAt: iso(report.created_at as Date),
    sections: sections.map((row) => {
      const payload = row.payload as JsonObject;
      return {
        key: String(row.section_key),
        title: String(payload.title),
        body: String(payload.body),
        ...(payload.unavailable === true ? { unavailable: true } : {}),
      };
    }),
  };
}

function historicalReadingConfiguration(row: DatabaseRow) {
  const spread = findSpread(String(row.spread_id), String(row.spread_version));
  if (!spread) throw new Error("READING_SPREAD_MISSING");
  return readingConfigurationSchema.parse({
    version: "reading-configuration-v1",
    reversalMode: "reversals_enabled",
    personalizationMode: "personalized_tarot",
    positions: spread.positions,
    capabilities: {
      trajectoryPositionIds: spread.capabilities?.trajectoryPositionIds ?? [],
      alternativePositionGroups: spread.capabilities?.alternativePositionGroups ?? [],
      timingMethod: spread.capabilities?.timingMethod ?? null,
      linkedPositions: spread.capabilities?.linkedPositions ?? [],
    },
  });
}

export function createPostgresRepositories(
  options: PostgresRepositoryOptions,
): ApplicationRepositories {
  if (!options.serviceRole && !options.actorUserId)
    throw new Error("A user-scoped repository requires an authenticated actor.");
  const client = clientFor(options.databaseUrl);

  const assertActor = (userId: string) => {
    if (!options.serviceRole && options.actorUserId !== userId)
      throw new Error("RLS_ACTOR_MISMATCH");
  };

  const userTransaction = async <T>(userId: string, work: (tx: Transaction) => Promise<T>) => {
    assertActor(userId);
    return client.begin(async (tx) => {
      await tx.unsafe(`set local role ${APPLICATION_DATABASE_ROLE}`);
      await tx`select set_config('request.jwt.claim.sub', ${userId}, true)`;
      return work(tx as Transaction);
    });
  };

  const serviceTransaction = async <T>(work: (tx: Transaction) => Promise<T>) => {
    if (!options.serviceRole) throw new Error("SERVICE_REPOSITORY_REQUIRED");
    return client.begin((tx) => work(tx as Transaction));
  };

  const users = {
    async ensure(input: Pick<RepositoryUser, "id" | "email">): Promise<RepositoryUser> {
      return userTransaction(input.id, async (tx) => {
        const [row] = await tx`
          insert into users (id, email)
          values (${input.id}, ${input.email.toLowerCase()})
          on conflict (id) do update set email = excluded.email
          returning id, email, created_at
        `;
        if (!row) throw new Error("USER_SYNC_FAILED");
        return {
          id: String(row.id),
          email: String(row.email),
          createdAt: iso(row.created_at as Date),
        };
      });
    },
    async get(userId: string): Promise<RepositoryUser | undefined> {
      return userTransaction(userId, async (tx) => {
        const [row] = await tx`select id, email, created_at from users where id = ${userId}`;
        return row
          ? { id: String(row.id), email: String(row.email), createdAt: iso(row.created_at as Date) }
          : undefined;
      });
    },
    async delete(userId: string) {
      await userTransaction(userId, async (tx) => {
        await tx`delete from users where id = ${userId}`;
      });
    },
  };

  const settings = {
    async get(userId: string): Promise<UserSettingsRecord | undefined> {
      return userTransaction(userId, async (tx) => {
        const [row] = await tx`
          select user_id, display_name, sound_enabled, reduced_motion
          from user_settings where user_id = ${userId}
        `;
        return row
          ? {
              userId: String(row.user_id),
              displayName: String(row.display_name),
              soundEnabled: Boolean(row.sound_enabled),
              reducedMotion: Boolean(row.reduced_motion),
            }
          : undefined;
      });
    },
    async upsert(record: UserSettingsRecord) {
      await userTransaction(record.userId, async (tx) => {
        await tx`
          insert into user_settings (user_id, display_name, sound_enabled, reduced_motion)
          values (${record.userId}, ${record.displayName}, ${record.soundEnabled}, ${record.reducedMotion})
          on conflict (user_id) do update set
            display_name = excluded.display_name,
            sound_enabled = excluded.sound_enabled,
            reduced_motion = excluded.reduced_motion,
            updated_at = now()
        `;
      });
    },
  };

  const consents = {
    async list(userId: string): Promise<ConsentRecord[]> {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          select policy, policy_version, accepted_at, withdrawn_at from consents
          where user_id = ${userId} order by accepted_at
        `;
        return rows.map((row) => ({
          policy: String(row.policy),
          version: String(row.policy_version),
          grantedAt: iso(row.accepted_at as Date),
          ...(row.withdrawn_at ? { withdrawnAt: iso(row.withdrawn_at as Date) } : {}),
        }));
      });
    },
    async grant(userId: string, consent: ConsentRecord) {
      await userTransaction(userId, async (tx) => {
        await tx`
          insert into consents (user_id, policy, policy_version, accepted_at)
          values (${userId}, ${consent.policy}, ${consent.version}, ${consent.grantedAt})
          on conflict (user_id, policy, policy_version) where withdrawn_at is null do nothing
        `;
      });
    },
    async withdraw(userId: string, policy: string, withdrawnAt: string) {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          update consents set withdrawn_at = ${withdrawnAt}
          where user_id = ${userId} and policy = ${policy} and withdrawn_at is null
          returning id
        `;
        return rows.length > 0;
      });
    },
  };

  const loadProfile = async (tx: Transaction, userId: string, snapshotId?: string) => {
    const rows = snapshotId
      ? await tx`
          select pi.payload->>'envelope' as encrypted_input, ps.derived_payload,
            pc.payload->>'envelope' as encrypted_calculations
          from profile_snapshots ps
          join birth_profiles bp on bp.id = ps.profile_id
          join profile_components pi on pi.snapshot_id = ps.id and pi.system = 'private-profile-input'
          join profile_components pc on pc.snapshot_id = ps.id and pc.system = 'private-calculations'
          where ps.user_id = ${userId} and ps.id = ${snapshotId}
        `
      : await tx`
          select pi.payload->>'envelope' as encrypted_input, ps.derived_payload,
            pc.payload->>'envelope' as encrypted_calculations
          from birth_profiles bp
          join profile_snapshots ps on ps.id = bp.active_snapshot_id
          join profile_components pi on pi.snapshot_id = ps.id and pi.system = 'private-profile-input'
          join profile_components pc on pc.snapshot_id = ps.id and pc.system = 'private-calculations'
          where bp.user_id = ${userId}
        `;
    return rows[0] ? profileFromRow(rows[0]) : undefined;
  };

  const birthProfiles = {
    async getActive(userId: string) {
      return userTransaction(userId, (tx) => loadProfile(tx, userId));
    },
    async saveVersion(userId: string, profile: StoredProfileVersion) {
      return userTransaction(userId, async (tx) => {
        await tx`
          insert into birth_profiles (id, user_id, encrypted_payload)
          values (${profile.snapshot.profileId}, ${userId}, ${profile.encryptedInput})
          on conflict (user_id) do nothing
        `;
        const [root] = await tx`
          select id from birth_profiles where user_id = ${userId} for update
        `;
        if (!root) throw new Error("PROFILE_ROOT_NOT_FOUND");
        const profileId = String(root.id);
        const [versionRow] = await tx`
          select coalesce(max(version), 0)::integer as version
          from profile_snapshots where profile_id = ${profileId}
        `;
        const snapshot = {
          ...profile.snapshot,
          profileId,
          version: Number(versionRow?.version ?? 0) + 1,
        };
        await tx`
          insert into profile_snapshots (
            id, user_id, profile_id, version, completeness, derived_payload, calculation_versions, created_at
          ) values (
            ${snapshot.id}, ${userId}, ${snapshot.profileId}, ${snapshot.version},
            ${snapshot.completeness},
            ${tx.json(json(profileDerivedPayload(snapshot)))},
            ${tx.json(json(snapshot.calculationVersions))}, ${snapshot.createdAt}
          )
        `;
        await tx`
          insert into profile_components (user_id, snapshot_id, system, status, payload)
          values
            (${userId}, ${snapshot.id}, 'private-profile-input', 'implemented',
              ${tx.json(json({ envelope: profile.encryptedInput }))}),
            (${userId}, ${snapshot.id}, 'private-calculations', 'implemented',
              ${tx.json(json({ envelope: profile.encryptedCalculations }))})
        `;
        for (const component of profile.components ?? [])
          await tx`
            insert into profile_components (user_id, snapshot_id, system, status, payload)
            values (${userId}, ${snapshot.id}, ${component.system}, ${component.status},
              ${tx.json(json(component.payload))})
          `;
        for (const trait of snapshot.traits)
          await tx`
            insert into profile_traits (user_id, snapshot_id, domain, statement, provenance)
            values (${userId}, ${snapshot.id}, ${trait.domain}, ${trait.statement},
              ${tx.json(
                json({
                  sourceSystem: trait.sourceSystem,
                  sourceRule: trait.sourceRule,
                  calculationVersion: trait.calculationVersion,
                  stability: trait.stability,
                  direction: trait.direction,
                  strength: trait.strength,
                  confidence: trait.confidence,
                  lifeDomains: trait.lifeDomains,
                }),
              )})
          `;
        await tx`
          update birth_profiles set
            encrypted_payload = ${profile.encryptedInput},
            active_snapshot_id = ${snapshot.id},
            updated_at = now()
          where id = ${snapshot.profileId} and user_id = ${userId}
        `;
        return snapshot;
      });
    },
    async listVersions(userId: string) {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          select pi.payload->>'envelope' as encrypted_input, ps.derived_payload,
            pc.payload->>'envelope' as encrypted_calculations
          from birth_profiles bp
          join profile_snapshots ps on ps.profile_id = bp.id
          join profile_components pi on pi.snapshot_id = ps.id and pi.system = 'private-profile-input'
          join profile_components pc on pc.snapshot_id = ps.id and pc.system = 'private-calculations'
          where bp.user_id = ${userId}
          order by ps.version
        `;
        return rows.map(profileFromRow);
      });
    },
    async delete(userId: string) {
      return userTransaction(userId, async (tx) => {
        const [profile] = await tx`select id from birth_profiles where user_id = ${userId}`;
        if (!profile) return false;
        // Readings deliberately retain a non-null snapshot lineage and are
        // private-profile dependants. Commerce FKs use ON DELETE SET NULL, so
        // paid orders, entitlements, report content, and reconciliation state
        // survive this profile-only operation.
        await tx`delete from reading_sessions where user_id = ${userId}`;
        await tx`delete from birth_profiles where id = ${String(profile.id)} and user_id = ${userId}`;
        return true;
      });
    },
  };

  const profileSnapshots = {
    async get(userId: string, snapshotId: string) {
      return userTransaction(userId, (tx) => loadProfile(tx, userId, snapshotId));
    },
    async list(userId: string): Promise<ProfileSnapshot[]> {
      return (await birthProfiles.listVersions(userId)).map(({ snapshot }) => snapshot);
    },
  };

  const profileComponents = {
    async list(userId: string, snapshotId: string): Promise<ProfileComponentRecord[]> {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          select snapshot_id, system, status, payload from profile_components
          where user_id = ${userId} and snapshot_id = ${snapshotId} order by system
        `;
        return rows.map((row) => ({
          snapshotId: String(row.snapshot_id),
          system: String(row.system),
          status: row.status as ProfileComponentRecord["status"],
          payload: row.payload,
        }));
      });
    },
  };

  const traits = {
    async list(userId: string, snapshotId: string): Promise<ProfileTraitRecord[]> {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          select snapshot_id, domain, statement, provenance from profile_traits
          where user_id = ${userId} and snapshot_id = ${snapshotId} order by created_at, id
        `;
        return rows.map((row) => {
          const provenance = row.provenance as JsonObject;
          return {
            snapshotId: String(row.snapshot_id),
            trait: profileTraitSchema.parse({
              domain: row.domain as ProfileTraitRecord["trait"]["domain"],
              statement: String(row.statement),
              sourceSystem: provenance.sourceSystem as ProfileTraitRecord["trait"]["sourceSystem"],
              sourceRule: String(provenance.sourceRule),
              calculationVersion: String(provenance.calculationVersion),
              stability: provenance.stability as ProfileTraitRecord["trait"]["stability"],
              direction: provenance.direction,
              strength: provenance.strength,
              confidence: provenance.confidence,
              lifeDomains: provenance.lifeDomains,
            }),
          };
        });
      });
    },
  };

  const hydrateReading = async (tx: Transaction, row: DatabaseRow): Promise<StoredReading> => {
    const [drawRow] = await tx`
      select deck_version, shuffle_version, assignments, proof, encrypted_server_seed, locked_at
      from reading_draws where reading_id = ${String(row.id)}
    `;
    if (!drawRow) throw new Error("LOCKED_DRAW_MISSING");
    const draw: LockedDraw = {
      id: String(row.id),
      deckVersion: String(drawRow.deck_version),
      spreadId: String(row.spread_id),
      spreadVersion: String(row.spread_version),
      shuffleVersion: String(drawRow.shuffle_version),
      assignments: drawRow.assignments as LockedDraw["assignments"],
      ...(drawRow.proof ? { proof: drawRow.proof as NonNullable<LockedDraw["proof"]> } : {}),
      lockedAt: iso(drawRow.locked_at as Date),
    };
    const [outputRow] = await tx`
      select provider_id, prompt_version, content_version, safety_policy_version,
             schema_version, payload
      from reading_outputs where reading_id = ${String(row.id)}
      order by created_at desc, id desc limit 1
    `;
    const followRows = await tx`
      select id, encrypted_question, output, provider_id, prompt_version,
             content_version, safety_policy_version, schema_version, created_at
      from follow_up_questions
      where reading_id = ${String(row.id)} order by created_at, id
    `;
    return {
      id: String(row.id),
      userId: String(row.user_id),
      idempotencyKey: String(row.idempotency_key),
      profileSnapshotId: String(row.profile_snapshot_id),
      readingLens: row.reading_lens as StoredReading["readingLens"],
      questionClassification: questionClassificationSchema.parse(row.question_classification),
      entitlementDecision: readingEntitlementDecisionSchema.parse(row.entitlement_decision),
      ...(row.ritual_progress
        ? { ritualProgress: ritualProgressSchema.parse(row.ritual_progress) }
        : {}),
      expiresAt: iso(row.expires_at as Date),
      spreadId: String(row.spread_id),
      configuration: row.configuration
        ? readingConfigurationSchema.parse(row.configuration)
        : historicalReadingConfiguration(row),
      encryptedQuestion: String(row.encrypted_question),
      ...(drawRow.encrypted_server_seed
        ? { encryptedServerSeed: String(drawRow.encrypted_server_seed) }
        : {}),
      safetyClassification: String(row.safety_classification),
      draw,
      ...(outputRow ? { result: readingResultSchema.parse(outputRow.payload) } : {}),
      ...(outputRow
        ? {
            outputProvenance: readingOutputProvenanceSchema.parse({
              providerId: outputRow.provider_id,
              promptVersion: outputRow.prompt_version,
              contentVersion: outputRow.content_version,
              safetyPolicyVersion: outputRow.safety_policy_version,
              schemaVersion: outputRow.schema_version,
            }),
          }
        : {}),
      generationStatus: row.state as StoredReading["generationStatus"],
      followUps: followRows.map((follow) => ({
        id: String(follow.id),
        encryptedQuestion: String(follow.encrypted_question),
        result: normalizeFollowUpResult(follow.output),
        outputProvenance: readingOutputProvenanceSchema.parse({
          providerId: follow.provider_id,
          promptVersion: follow.prompt_version,
          contentVersion: follow.content_version,
          safetyPolicyVersion: follow.safety_policy_version,
          schemaVersion: follow.schema_version,
        }),
        createdAt: iso(follow.created_at as Date),
      })),
      createdAt: iso(row.created_at as Date),
    };
  };

  const readingSessions = {
    async createLocked(reading: StoredReading) {
      return userTransaction(reading.userId, async (tx) => {
        const [idempotent] = await tx`
          select * from reading_sessions
          where user_id = ${reading.userId} and idempotency_key = ${reading.idempotencyKey}
        `;
        if (idempotent) return hydrateReading(tx, idempotent);

        const [activeContent] = await tx`
          select d.version as deck_version, s.id as spread_id
          from decks d
          cross join spreads s
          where d.version = ${reading.draw.deckVersion} and d.active = true
            and s.id = ${reading.spreadId} and s.version = ${reading.draw.spreadVersion}
            and s.active = true
        `;
        if (!activeContent) throw new Error("READING_CONTENT_INACTIVE");

        const [created] = await tx`
          insert into reading_sessions (
            id, user_id, profile_snapshot_id, spread_id, spread_version, idempotency_key,
            encrypted_question,
            reading_lens, configuration, question_classification, entitlement_decision,
            ritual_progress, expires_at,
            safety_classification, state, created_at
          ) values (
            ${reading.id}, ${reading.userId}, ${reading.profileSnapshotId}, ${reading.spreadId},
            ${reading.draw.spreadVersion}, ${reading.idempotencyKey}, ${reading.encryptedQuestion},
            ${tx.json(json(reading.readingLens))},
            ${tx.json(json(reading.configuration))},
            ${tx.json(json(reading.questionClassification))},
            ${tx.json(json(reading.entitlementDecision))},
            ${reading.ritualProgress ? tx.json(json(reading.ritualProgress)) : null},
            ${reading.expiresAt},
            ${reading.safetyClassification}, ${reading.generationStatus},
            ${reading.createdAt}
          )
          on conflict (user_id, idempotency_key) do nothing
          returning id
        `;
        if (!created) {
          const [existing] = await tx`
            select * from reading_sessions
            where user_id = ${reading.userId} and idempotency_key = ${reading.idempotencyKey}
          `;
          if (!existing) throw new Error("READING_IDEMPOTENCY_CONFLICT");
          return hydrateReading(tx, existing);
        }
        await tx`
          insert into reading_draws (
            user_id, reading_id, deck_version, shuffle_version, assignments, proof,
            encrypted_server_seed, locked_at
          ) values (
            ${reading.userId}, ${reading.id}, ${reading.draw.deckVersion},
            ${reading.draw.shuffleVersion}, ${tx.json(json(reading.draw.assignments))},
            ${reading.draw.proof ? tx.json(json(reading.draw.proof)) : null},
            ${reading.encryptedServerSeed ?? null}, ${reading.draw.lockedAt}
          )
        `;
        // Same transaction as the reading it belongs to (see
        // insertInterpretationJob's doc comment) — "reading persisted but its
        // job never was" is structurally impossible, not just unlikely.
        await insertInterpretationJob(tx, { userId: reading.userId, readingId: reading.id });
        return reading;
      });
    },
    async get(userId: string, readingId: string) {
      return userTransaction(userId, async (tx) => {
        const [row] = await tx`
          select * from reading_sessions where id = ${readingId} and user_id = ${userId}
        `;
        return row ? hydrateReading(tx, row) : undefined;
      });
    },
    async list(userId: string) {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          select * from reading_sessions where user_id = ${userId}
          order by created_at desc, id desc
        `;
        return Promise.all(rows.map((row) => hydrateReading(tx, row)));
      });
    },
    async delete(userId: string, readingId: string) {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          delete from reading_sessions where id = ${readingId} and user_id = ${userId}
          returning id
        `;
        return rows.length === 1;
      });
    },
    async setGenerationStatus(
      userId: string,
      readingId: string,
      status: StoredReading["generationStatus"],
    ) {
      await userTransaction(userId, async (tx) => {
        await tx`
          update reading_sessions set state = ${status}, updated_at = now()
          where id = ${readingId} and user_id = ${userId}
        `;
      });
    },
    async updateRitualProgress(userId: string, readingId: string, progress: StoredRitualProgress) {
      const parsed = ritualProgressSchema.parse(progress);
      await userTransaction(userId, async (tx) => {
        const rows = await tx`
          update reading_sessions set ritual_progress = ${tx.json(json(parsed))}, updated_at = now()
          where id = ${readingId} and user_id = ${userId}
          returning id
        `;
        if (rows.length !== 1) throw new Error("READING_NOT_FOUND");
      });
    },
  };

  const lockedDraws = {
    async get(userId: string, readingId: string) {
      return (await readingSessions.get(userId, readingId))?.draw;
    },
  };

  const outputs = {
    async save(
      userId: string,
      readingId: string,
      result: ReadingResult,
      provenance: ReadingOutputProvenance,
    ) {
      const verifiedProvenance = readingOutputProvenanceSchema.parse(provenance);
      await userTransaction(userId, async (tx) => {
        await tx`
          insert into reading_outputs (
            user_id, reading_id, provider_id, prompt_version, content_version,
            safety_policy_version, schema_version, payload
          ) values (
            ${userId}, ${readingId}, ${verifiedProvenance.providerId},
            ${verifiedProvenance.promptVersion},
            ${verifiedProvenance.contentVersion ?? TAROT_CONTENT_VERSION},
            ${verifiedProvenance.safetyPolicyVersion ?? "question-safety-v2"},
            ${verifiedProvenance.schemaVersion}, ${tx.json(json(readingResultSchema.parse(result)))}
          )
        `;
        await tx`
          update reading_sessions set state = 'ready', updated_at = now()
          where id = ${readingId} and user_id = ${userId}
        `;
      });
    },
    async latest(userId: string, readingId: string) {
      return userTransaction(userId, async (tx) => {
        const [row] = await tx`
          select payload from reading_outputs
          where user_id = ${userId} and reading_id = ${readingId}
          order by created_at desc, id desc limit 1
        `;
        return row ? readingResultSchema.parse(row.payload) : undefined;
      });
    },
  };

  const followUps = {
    async list(userId: string, readingId: string): Promise<StoredFollowUp[]> {
      return (await readingSessions.get(userId, readingId))?.followUps ?? [];
    },
    async create(
      userId: string,
      readingId: string,
      followUp: StoredFollowUp,
      policy: { limit: number },
    ) {
      await userTransaction(userId, async (tx) => {
        const [reading] = await tx`
          select id from reading_sessions
          where id = ${readingId} and user_id = ${userId}
          for update
        `;
        if (!reading) throw new Error("READING_NOT_FOUND");
        const [usage] = await tx`
          select count(*)::int as count from follow_up_questions
          where reading_id = ${readingId} and user_id = ${userId}
        `;
        if (Number(usage?.count ?? 0) >= policy.limit) throw new Error("FOLLOW_UP_LIMIT_REACHED");
        await tx`
          insert into follow_up_questions (
            id, user_id, reading_id, encrypted_question, output, provider_id,
            prompt_version, content_version, safety_policy_version, schema_version, created_at
          ) values (
            ${followUp.id}, ${userId}, ${readingId}, ${followUp.encryptedQuestion},
            ${tx.json(json(followUpResultSchema.parse(followUp.result)))},
            ${followUp.outputProvenance.providerId}, ${followUp.outputProvenance.promptVersion},
            ${followUp.outputProvenance.contentVersion ?? TAROT_CONTENT_VERSION},
            ${followUp.outputProvenance.safetyPolicyVersion ?? "question-safety-v2"},
            ${followUp.outputProvenance.schemaVersion}, ${followUp.createdAt}
          )
        `;
      });
    },
  };

  const loadReport = async (userId: string, reportId: string, requireActive: boolean) => {
    return userTransaction(userId, async (tx) => {
      const [report] = await tx`
          select r.*, e.order_id, o.provider from reports r
          join entitlements e on e.id = r.entitlement_id
          join orders o on o.id = e.order_id
          where r.id = ${reportId} and r.user_id = ${userId}
            and (${requireActive} = false or e.status = 'active')
        `;
      if (!report) return undefined;
      const sections = await tx`
          select section_key, payload from report_sections
          where report_id = ${reportId} and user_id = ${userId} order by created_at, id
        `;
      return reportFromRows(report, sections);
    });
  };

  const reports = {
    async get(userId: string, reportId: string) {
      return loadReport(userId, reportId, true);
    },
    async getByOrder(userId: string, orderId: string) {
      return userTransaction(userId, async (tx) => {
        const [row] = await tx`
          select r.id from reports r
          join entitlements e on e.id = r.entitlement_id
          where r.user_id = ${userId} and e.order_id = ${orderId} and e.status = 'active'
        `;
        return row ? reports.get(userId, String(row.id)) : undefined;
      });
    },
    async create(report: StoredReport) {
      await userTransaction(report.userId, async (tx) => {
        const [entitlement] = await tx`
          select id from entitlements
          where order_id = ${report.orderId} and user_id = ${report.userId} and status = 'active'
        `;
        if (!entitlement) throw new Error("ENTITLEMENT_NOT_FOUND");
        await tx`
          insert into reports (
            id, user_id, entitlement_id, profile_snapshot_id, status, template_version, payload, created_at
          ) values (
            ${report.id}, ${report.userId}, ${String(entitlement.id)}, ${report.snapshotId},
            ${report.status}, 'profile-report-v1', ${tx.json(json({ sectionCount: report.sections.length }))},
            ${report.createdAt}
          )
        `;
        for (const section of report.sections)
          await tx`
            insert into report_sections (user_id, report_id, section_key, payload, created_at)
            values (
              ${report.userId}, ${report.id}, ${section.key},
              ${tx.json(
                json({
                  title: section.title,
                  body: section.body,
                  ...(section.unavailable ? { unavailable: true } : {}),
                }),
              )},
              ${report.createdAt}
            )
          `;
      });
    },
    async list(userId: string) {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          select r.id from reports r where r.user_id = ${userId} order by r.created_at, r.id
        `;
        const result: StoredReport[] = [];
        for (const row of rows) {
          const report = await reports.get(userId, String(row.id));
          if (report) result.push(report);
        }
        return result;
      });
    },
    async listForExport(userId: string) {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          select id from reports where user_id = ${userId} order by created_at, id
        `;
        const result: StoredReport[] = [];
        for (const row of rows) {
          const report = await loadReport(userId, String(row.id), false);
          if (report) result.push(report);
        }
        return result;
      });
    },
  };

  const orders = {
    async create(order: StoredOrder, encryptedReportSource?: string) {
      await userTransaction(order.userId, async (tx) => {
        await tx`
          insert into orders (
            id, user_id, product_id, profile_snapshot_id, provider, provider_session_id,
            idempotency_key, encrypted_report_source, status, created_at
          ) values (
            ${order.id}, ${order.userId}, 'profile-report-v1', ${order.snapshotId},
            ${order.provider}, ${order.providerSessionId}, ${order.idempotencyKey},
            ${encryptedReportSource ?? null}, ${order.status}, ${order.createdAt}
          )
        `;
      });
    },
    async get(userId: string, orderId: string) {
      return userTransaction(userId, async (tx) => {
        const [row] = await tx`select * from orders where id = ${orderId} and user_id = ${userId}`;
        return row ? orderFromRow(row) : undefined;
      });
    },
    async getByIdempotencyKey(userId: string, key: string) {
      return userTransaction(userId, async (tx) => {
        const [row] = await tx`
          select * from orders where user_id = ${userId} and idempotency_key = ${key}
        `;
        return row ? orderFromRow(row) : undefined;
      });
    },
    async getByProviderSession(providerSessionId: string) {
      return serviceTransaction(async (tx) => {
        const [row] = await tx`
          select * from orders where provider_session_id = ${providerSessionId}
        `;
        return row ? orderFromRow(row) : undefined;
      });
    },
    async getByProviderReference(orderId: string) {
      return serviceTransaction(async (tx) => {
        const [row] = await tx`select * from orders where id = ${orderId}`;
        return row ? orderFromRow(row) : undefined;
      });
    },
    async replaceProviderSession(
      userId: string,
      orderId: string,
      expectedProviderSessionId: string,
      providerSessionId: string,
    ) {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          update orders set provider_session_id = ${providerSessionId}, updated_at = now()
          where id = ${orderId} and user_id = ${userId}
            and provider_session_id = ${expectedProviderSessionId} and status = 'pending'
          returning id
        `;
        return rows.length === 1;
      });
    },
    async clearReportSource(orderId: string) {
      await serviceTransaction(async (tx) => {
        await tx`
          update orders set encrypted_report_source = null, updated_at = now()
          where id = ${orderId}
        `;
      });
    },
    async setStatus(orderId: string, status: StoredOrder["status"]) {
      if (options.serviceRole)
        await serviceTransaction(async (tx) => {
          await tx`update orders set status = ${status}, updated_at = now() where id = ${orderId}`;
        });
      else if (options.actorUserId) {
        const actorUserId = options.actorUserId;
        await userTransaction(actorUserId, async (tx) => {
          await tx`
            update orders set status = ${status}, updated_at = now()
            where id = ${orderId} and user_id = ${actorUserId}
          `;
        });
      }
    },
    async list(userId: string) {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`select * from orders where user_id = ${userId} order by created_at`;
        return rows.map(orderFromRow);
      });
    },
  };

  const entitlements = {
    async grant(entitlement: StoredEntitlement) {
      const work = async (tx: Transaction) => {
        await tx`
          insert into entitlements (
            id, user_id, product_id, profile_snapshot_id, order_id, status, created_at
          ) values (
            ${entitlement.id}, ${entitlement.userId}, 'profile-report-v1',
            ${entitlement.snapshotId}, ${entitlement.orderId}, ${entitlement.status},
            ${entitlement.createdAt}
          ) on conflict (order_id) do nothing
        `;
      };
      if (options.serviceRole) await serviceTransaction(work);
      else await userTransaction(entitlement.userId, work);
    },
    async revokeByOrder(orderId: string) {
      const work = async (tx: Transaction) => {
        await tx`update entitlements set status = 'revoked' where order_id = ${orderId}`;
      };
      if (options.serviceRole) await serviceTransaction(work);
      else if (options.actorUserId) await userTransaction(options.actorUserId, work);
    },
    async list(userId: string) {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          select * from entitlements where user_id = ${userId} order by created_at
        `;
        return rows.map(entitlementFromRow);
      });
    },
  };

  const reportFulfillment = {
    async enqueuePaid(input: {
      orderId: string;
      userId: string;
      snapshotId: string | null;
      reportId: string;
      entitlementId: string;
      createdAt: string;
    }): Promise<StoredReport> {
      return serviceTransaction(async (tx) => {
        const [order] = await tx`
          select * from orders where id = ${input.orderId} for update
        `;
        if (
          !order ||
          String(order.user_id) !== input.userId ||
          (order.profile_snapshot_id ? String(order.profile_snapshot_id) : null) !==
            input.snapshotId ||
          order.provider !== "stripe" ||
          order.status === "refunded" ||
          order.status === "disputed"
        )
          throw new Error("ORDER_NOT_FULFILLABLE");
        const [existing] = await tx`
          select r.id from reports r
          join entitlements e on e.id = r.entitlement_id
          where e.order_id = ${input.orderId}
        `;
        if (existing) {
          const [report] = await tx`
            select r.*, e.order_id, o.provider from reports r
            join entitlements e on e.id = r.entitlement_id
            join orders o on o.id = e.order_id
            where r.id = ${String(existing.id)}
          `;
          const sections = await tx`
            select section_key, payload from report_sections
            where report_id = ${String(existing.id)} order by created_at, id
          `;
          if (!report) throw new Error("REPORT_NOT_FOUND");
          return reportFromRows(report, sections);
        }
        if (!order.encrypted_report_source) throw new Error("REPORT_SOURCE_NOT_FOUND");
        const encryptedSource = String(order.encrypted_report_source);
        await tx`
          update orders set status = 'paid', encrypted_report_source = null, updated_at = now()
          where id = ${input.orderId}
        `;
        await tx`
          insert into entitlements (
            id, user_id, product_id, profile_snapshot_id, order_id, status, created_at
          ) values (
            ${input.entitlementId}, ${input.userId}, 'profile-report-v1', ${input.snapshotId},
            ${input.orderId}, 'active', ${input.createdAt}
          )
          on conflict (order_id) do update set status = 'active'
        `;
        const [entitlement] = await tx`
          select id from entitlements where order_id = ${input.orderId}
        `;
        if (!entitlement) throw new Error("ENTITLEMENT_NOT_FOUND");
        await tx`
          insert into reports (
            id, user_id, entitlement_id, profile_snapshot_id, status, template_version,
            payload, created_at
          ) values (
            ${input.reportId}, ${input.userId}, ${String(entitlement.id)}, ${input.snapshotId},
            'pending', 'profile-report-v2', ${tx.json(json({ sectionCount: 0 }))},
            ${input.createdAt}
          )
        `;
        await tx`
          insert into report_jobs (user_id, report_id, encrypted_source)
          values (${input.userId}, ${input.reportId}, ${encryptedSource})
        `;
        return {
          id: input.reportId,
          userId: input.userId,
          snapshotId: input.snapshotId,
          orderId: input.orderId,
          provider: "stripe",
          status: "pending",
          sections: [],
          createdAt: input.createdAt,
        };
      });
    },
  };

  const audit = {
    async record(record: Omit<AuditRecord, "createdAt">) {
      await userTransaction(record.userId, async (tx) => {
        await tx`
          insert into audit_events (user_id, action, target_type, target_id, metadata)
          values (
            ${record.userId}, ${record.action}, ${record.targetType}, ${record.targetId},
            ${tx.json(json(record.metadata))}
          )
        `;
      });
    },
    async list(userId: string) {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          select user_id, action, target_type, target_id, metadata, created_at
          from audit_events where user_id = ${userId} order by created_at, id
        `;
        return rows.map((row) => ({
          userId: String(row.user_id),
          action: String(row.action),
          targetType: String(row.target_type),
          targetId: String(row.target_id),
          metadata: row.metadata as AuditRecord["metadata"],
          createdAt: iso(row.created_at as Date),
        }));
      });
    },
  };

  const feedback = {
    async create(input: {
      userId: string;
      readingId: string;
      kind: StoredFeedback["kind"];
      resonance?: number;
      helpfulness?: number;
      outcomeStatus?: StoredFeedback["outcomeStatus"];
      behaviorChanged?: boolean;
      encryptedComment?: string;
    }): Promise<StoredFeedback> {
      return userTransaction(input.userId, async (tx) => {
        const feedback: StoredFeedback = {
          id: randomUUID(),
          userId: input.userId,
          readingId: input.readingId,
          kind: input.kind,
          ...(input.resonance === undefined ? {} : { resonance: input.resonance }),
          ...(input.helpfulness === undefined ? {} : { helpfulness: input.helpfulness }),
          ...(input.outcomeStatus === undefined ? {} : { outcomeStatus: input.outcomeStatus }),
          ...(input.behaviorChanged === undefined
            ? {}
            : { behaviorChanged: input.behaviorChanged }),
          ...(input.encryptedComment === undefined
            ? {}
            : { encryptedComment: input.encryptedComment }),
          createdAt: new Date().toISOString(),
        };
        await tx`
          insert into reading_feedback (
            id, user_id, reading_id, kind, resonance, helpfulness, outcome_status,
            behavior_changed, encrypted_comment, created_at
          ) values (
            ${feedback.id}, ${feedback.userId}, ${feedback.readingId}, ${feedback.kind},
            ${feedback.resonance ?? null}, ${feedback.helpfulness ?? null},
            ${feedback.outcomeStatus ?? null}, ${feedback.behaviorChanged ?? null},
            ${feedback.encryptedComment ?? null}, ${feedback.createdAt}
          )
        `;
        return feedback;
      });
    },
    async list(userId: string, readingId?: string): Promise<StoredFeedback[]> {
      return userTransaction(userId, async (tx) => {
        const rows = readingId
          ? await tx`
              select * from reading_feedback
              where user_id = ${userId} and reading_id = ${readingId}
              order by created_at, id
            `
          : await tx`
              select * from reading_feedback
              where user_id = ${userId} order by created_at, id
            `;
        return rows.map((row) => ({
          id: String(row.id),
          userId: String(row.user_id),
          readingId: String(row.reading_id),
          kind: row.kind === "outcome" ? "outcome" : "experience",
          ...(row.resonance === null || row.resonance === undefined
            ? {}
            : { resonance: Number(row.resonance) }),
          ...(row.helpfulness === null || row.helpfulness === undefined
            ? {}
            : { helpfulness: Number(row.helpfulness) }),
          ...(row.outcome_status
            ? {
                outcomeStatus: row.outcome_status as NonNullable<StoredFeedback["outcomeStatus"]>,
              }
            : {}),
          ...(row.behavior_changed === null || row.behavior_changed === undefined
            ? {}
            : { behaviorChanged: Boolean(row.behavior_changed) }),
          ...(row.encrypted_comment ? { encryptedComment: String(row.encrypted_comment) } : {}),
          createdAt: iso(row.created_at as Date),
        }));
      });
    },
  };

  const privacy = {
    async export(userId: string) {
      const user = await users.get(userId);
      if (!user) throw new Error("USER_NOT_FOUND");
      const userSettings = await settings.get(userId);
      return {
        user,
        ...(userSettings ? { settings: userSettings } : {}),
        consents: await consents.list(userId),
        profiles: await birthProfiles.listVersions(userId),
        readings: await readingSessions.list(userId),
        feedback: await feedback.list(userId),
        reports: await reports.listForExport(userId),
        orders: await orders.list(userId),
        entitlements: await entitlements.list(userId),
        auditEvents: await audit.list(userId),
      };
    },
    async deleteAccount(userId: string) {
      await users.delete(userId);
    },
  };

  return {
    users,
    settings,
    consents,
    birthProfiles,
    profileSnapshots,
    profileComponents,
    traits,
    readingSessions,
    lockedDraws,
    outputs,
    followUps,
    history: { listReadings: readingSessions.list },
    feedback,
    reports,
    reportFulfillment,
    orders,
    entitlements,
    webhookEvents: {
      async begin(providerEventId: string, eventType: string) {
        return serviceTransaction(async (tx) => {
          const rows = await tx`
            insert into payment_webhook_events (
              provider_event_id, event_type, processing_started_at, attempt_count
            ) values (${providerEventId}, ${eventType}, now(), 1)
            on conflict (provider_event_id) do update set
              event_type = excluded.event_type,
              processing_started_at = now(),
              attempt_count = payment_webhook_events.attempt_count + 1,
              last_failure_code = null
            where payment_webhook_events.processed_at is null
              and (
                payment_webhook_events.processing_started_at is null
                or payment_webhook_events.processing_started_at < now() - interval '5 minutes'
              )
            returning id
          `;
          return rows.length === 1;
        });
      },
      async complete(providerEventId: string) {
        await serviceTransaction(async (tx) => {
          await tx`
            update payment_webhook_events
            set processed_at = now(), processing_started_at = null, last_failure_code = null
            where provider_event_id = ${providerEventId}
          `;
        });
      },
      async fail(providerEventId: string, failureCode: string) {
        await serviceTransaction(async (tx) => {
          await tx`
            update payment_webhook_events
            set processing_started_at = null, last_failure_code = ${failureCode}
            where provider_event_id = ${providerEventId} and processed_at is null
          `;
        });
      },
    },
    audit,
    privacy,
  };
}
