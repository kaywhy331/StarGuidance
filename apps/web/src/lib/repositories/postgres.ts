import "server-only";

import { randomUUID } from "node:crypto";

import {
  profileSnapshotSchema,
  readingResultSchema,
  type ProfileSnapshot,
  type ReadingResult,
} from "@starguidance/contracts";
import type {
  ApplicationRepositories,
  AuditRecord,
  ConsentRecord,
  ProfileComponentRecord,
  ProfileTraitRecord,
  RepositoryUser,
  StoredEntitlement,
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
import { createDatabaseClient } from "@starguidance/database";
import { TAROT_CONTENT_VERSION } from "@starguidance/tarot-content";
import type { LockedDraw } from "@starguidance/tarot-domain";

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

function clientFor(databaseUrl: string): DatabaseClient {
  const clients = (globalDatabase.__starGuidancePostgresClients ??= new Map());
  const existing = clients.get(databaseUrl);
  if (existing) return existing;
  const client = createDatabaseClient(databaseUrl);
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
  const metadata = payload.metadata as JsonObject;
  return {
    encryptedInput: String(row.encrypted_input),
    encryptedCalculations: String(row.encrypted_calculations),
    snapshot: profileSnapshotSchema.parse(payload.snapshot),
    maskedName: String(metadata.maskedName),
    birthDate: String(metadata.birthDate),
    timeKind: metadata.timeKind as StoredProfileVersion["timeKind"],
    ...(metadata.birthplaceLabel ? { birthplaceLabel: String(metadata.birthplaceLabel) } : {}),
  };
}

function orderFromRow(row: DatabaseRow): StoredOrder {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    snapshotId: String(row.profile_snapshot_id),
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
    snapshotId: String(row.profile_snapshot_id),
    orderId: String(row.order_id),
    status: row.status as StoredEntitlement["status"],
    createdAt: iso(row.created_at as Date),
  };
}

function reportFromRows(report: DatabaseRow, sections: readonly DatabaseRow[]): StoredReport {
  return {
    id: String(report.id),
    userId: String(report.user_id),
    snapshotId: String(report.profile_snapshot_id),
    orderId: String(report.order_id),
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
      await tx.unsafe("set local role authenticated");
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
          select policy, policy_version, accepted_at from consents
          where user_id = ${userId} order by accepted_at
        `;
        return rows.map((row) => ({
          policy: String(row.policy),
          version: String(row.policy_version),
          grantedAt: iso(row.accepted_at as Date),
        }));
      });
    },
    async grant(userId: string, consent: ConsentRecord) {
      await userTransaction(userId, async (tx) => {
        await tx`
          insert into consents (user_id, policy, policy_version, accepted_at)
          values (${userId}, ${consent.policy}, ${consent.version}, ${consent.grantedAt})
          on conflict (user_id, policy, policy_version) do nothing
        `;
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
      await userTransaction(userId, async (tx) => {
        const [existing] = await tx`
          select id from birth_profiles where user_id = ${userId} for update
        `;
        if (existing && String(existing.id) !== profile.snapshot.profileId)
          throw new Error("PROFILE_ID_MISMATCH");
        if (!existing) {
          await tx`
            insert into birth_profiles (id, user_id, encrypted_payload)
            values (${profile.snapshot.profileId}, ${userId}, ${profile.encryptedInput})
          `;
        }
        const [versionRow] = await tx`
          select coalesce(max(version), 0)::integer as version
          from profile_snapshots where profile_id = ${profile.snapshot.profileId}
        `;
        if (Number(versionRow?.version ?? 0) + 1 !== profile.snapshot.version)
          throw new Error("PROFILE_VERSION_CONFLICT");
        await tx`
          insert into profile_snapshots (
            id, user_id, profile_id, version, completeness, derived_payload, calculation_versions, created_at
          ) values (
            ${profile.snapshot.id}, ${userId}, ${profile.snapshot.profileId}, ${profile.snapshot.version},
            ${profile.snapshot.completeness},
            ${tx.json(
              json({
                snapshot: profile.snapshot,
                metadata: {
                  maskedName: profile.maskedName,
                  birthDate: profile.birthDate,
                  timeKind: profile.timeKind,
                  ...(profile.birthplaceLabel ? { birthplaceLabel: profile.birthplaceLabel } : {}),
                },
              }),
            )},
            ${tx.json(json(profile.snapshot.calculationVersions))}, ${profile.snapshot.createdAt}
          )
        `;
        await tx`
          insert into profile_components (user_id, snapshot_id, system, status, payload)
          values
            (${userId}, ${profile.snapshot.id}, 'private-profile-input', 'implemented',
              ${tx.json(json({ envelope: profile.encryptedInput }))}),
            (${userId}, ${profile.snapshot.id}, 'private-calculations', 'implemented',
              ${tx.json(json({ envelope: profile.encryptedCalculations }))}),
            (${userId}, ${profile.snapshot.id}, 'western-astrology', 'unavailable',
              ${tx.json(json({ facts: [], reason: "Validation and licensing gate remains closed." }))}),
            (${userId}, ${profile.snapshot.id}, 'bazi', 'unavailable',
              ${tx.json(json({ facts: [], reason: "Convention and validation gate remains closed." }))})
        `;
        for (const trait of profile.snapshot.traits)
          await tx`
            insert into profile_traits (user_id, snapshot_id, domain, statement, provenance)
            values (${userId}, ${profile.snapshot.id}, ${trait.domain}, ${trait.statement},
              ${tx.json(
                json({
                  sourceSystem: trait.sourceSystem,
                  sourceRule: trait.sourceRule,
                  calculationVersion: trait.calculationVersion,
                  stability: trait.stability,
                }),
              )})
          `;
        await tx`
          update birth_profiles set
            encrypted_payload = ${profile.encryptedInput},
            active_snapshot_id = ${profile.snapshot.id},
            updated_at = now()
          where id = ${profile.snapshot.profileId} and user_id = ${userId}
        `;
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
            trait: {
              domain: row.domain as ProfileTraitRecord["trait"]["domain"],
              statement: String(row.statement),
              sourceSystem: provenance.sourceSystem as ProfileTraitRecord["trait"]["sourceSystem"],
              sourceRule: String(provenance.sourceRule),
              calculationVersion: String(provenance.calculationVersion),
              stability: provenance.stability as ProfileTraitRecord["trait"]["stability"],
            },
          };
        });
      });
    },
  };

  const hydrateReading = async (tx: Transaction, row: DatabaseRow): Promise<StoredReading> => {
    const [drawRow] = await tx`
      select deck_version, shuffle_version, assignments, locked_at
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
      lockedAt: iso(drawRow.locked_at as Date),
    };
    const [outputRow] = await tx`
      select payload from reading_outputs where reading_id = ${String(row.id)}
      order by created_at desc, id desc limit 1
    `;
    const followRows = await tx`
      select id, encrypted_question, output, created_at from follow_up_questions
      where reading_id = ${String(row.id)} order by created_at, id
    `;
    return {
      id: String(row.id),
      userId: String(row.user_id),
      profileSnapshotId: String(row.profile_snapshot_id),
      readingLens: row.reading_lens as StoredReading["readingLens"],
      spreadId: String(row.spread_id),
      encryptedQuestion: String(row.encrypted_question),
      safetyClassification: String(row.safety_classification),
      draw,
      ...(outputRow ? { result: readingResultSchema.parse(outputRow.payload) } : {}),
      generationStatus: row.state as StoredReading["generationStatus"],
      followUps: followRows.map((follow) => ({
        id: String(follow.id),
        encryptedQuestion: String(follow.encrypted_question),
        result: readingResultSchema.parse(follow.output),
        createdAt: iso(follow.created_at as Date),
      })),
      createdAt: iso(row.created_at as Date),
    };
  };

  const readingSessions = {
    async createLocked(reading: StoredReading) {
      await userTransaction(reading.userId, async (tx) => {
        await tx`
          insert into reading_sessions (
            id, user_id, profile_snapshot_id, spread_id, spread_version, encrypted_question,
            reading_lens, safety_classification, state, created_at
          ) values (
            ${reading.id}, ${reading.userId}, ${reading.profileSnapshotId}, ${reading.spreadId},
            ${reading.draw.spreadVersion}, ${reading.encryptedQuestion},
            ${tx.json(json(reading.readingLens))}, ${reading.safetyClassification}, ${reading.generationStatus},
            ${reading.createdAt}
          )
        `;
        await tx`
          insert into reading_draws (
            user_id, reading_id, deck_version, shuffle_version, assignments, locked_at
          ) values (
            ${reading.userId}, ${reading.id}, ${reading.draw.deckVersion},
            ${reading.draw.shuffleVersion}, ${tx.json(json(reading.draw.assignments))},
            ${reading.draw.lockedAt}
          )
        `;
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
  };

  const lockedDraws = {
    async get(userId: string, readingId: string) {
      return (await readingSessions.get(userId, readingId))?.draw;
    },
  };

  const outputs = {
    async save(userId: string, readingId: string, result: ReadingResult) {
      await userTransaction(userId, async (tx) => {
        await tx`
          insert into reading_outputs (
            user_id, reading_id, provider_id, prompt_version, content_version, schema_version, payload
          ) values (
            ${userId}, ${readingId}, 'deterministic-fallback', 'deterministic-fallback-v1',
            ${TAROT_CONTENT_VERSION}, 'reading-result-v1', ${tx.json(json(readingResultSchema.parse(result)))}
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
    async create(userId: string, readingId: string, followUp: StoredFollowUp) {
      await userTransaction(userId, async (tx) => {
        await tx`
          insert into follow_up_questions (
            id, user_id, reading_id, encrypted_question, output, created_at
          ) values (
            ${followUp.id}, ${userId}, ${readingId}, ${followUp.encryptedQuestion},
            ${tx.json(json(readingResultSchema.parse(followUp.result)))}, ${followUp.createdAt}
          )
        `;
      });
    },
  };

  const reports = {
    async get(userId: string, reportId: string) {
      return userTransaction(userId, async (tx) => {
        const [report] = await tx`
          select r.*, e.order_id from reports r
          join entitlements e on e.id = r.entitlement_id
          where r.id = ${reportId} and r.user_id = ${userId}
        `;
        if (!report) return undefined;
        const sections = await tx`
          select section_key, payload from report_sections
          where report_id = ${reportId} and user_id = ${userId} order by created_at, id
        `;
        return reportFromRows(report, sections);
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
  };

  const orders = {
    async create(order: StoredOrder) {
      await userTransaction(order.userId, async (tx) => {
        await tx`
          insert into orders (
            id, user_id, product_id, profile_snapshot_id, provider, provider_session_id,
            idempotency_key, status, created_at
          ) values (
            ${order.id}, ${order.userId}, 'profile-report-v1', ${order.snapshotId},
            ${order.provider}, ${order.providerSessionId}, ${order.idempotencyKey},
            ${order.status}, ${order.createdAt}
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
    async list(userId: string) {
      return userTransaction(userId, async (tx) => {
        const rows = await tx`
          select * from entitlements where user_id = ${userId} order by created_at
        `;
        return rows.map(entitlementFromRow);
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
        reports: await reports.list(userId),
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
    feedback: {
      async create(input) {
        return userTransaction(input.userId, async (tx) => {
          const id = randomUUID();
          await tx`
            insert into reading_feedback (
              id, user_id, reading_id, resonance, helpfulness, encrypted_comment
            ) values (
              ${id}, ${input.userId}, ${input.readingId}, ${input.resonance ?? null},
              ${input.helpfulness ?? null}, ${input.encryptedComment ?? null}
            )
          `;
          return id;
        });
      },
    },
    reports,
    orders,
    entitlements,
    webhookEvents: {
      async begin(providerEventId: string, eventType: string) {
        return serviceTransaction(async (tx) => {
          const rows = await tx`
            insert into payment_webhook_events (provider_event_id, event_type)
            values (${providerEventId}, ${eventType})
            on conflict (provider_event_id) do nothing returning id
          `;
          return rows.length === 1;
        });
      },
      async complete(providerEventId: string) {
        await serviceTransaction(async (tx) => {
          await tx`
            update payment_webhook_events set processed_at = now()
            where provider_event_id = ${providerEventId}
          `;
        });
      },
    },
    audit,
    privacy,
  };
}
