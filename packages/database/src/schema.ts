import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
const id = uuid("id").defaultRandom().primaryKey();

export const users = pgTable("users", { id, email: text("email").notNull().unique(), createdAt });
const userId = () =>
  uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" });
export const userSettings = pgTable("user_settings", {
  id,
  userId: userId().unique(),
  displayName: text("display_name").notNull(),
  soundEnabled: boolean("sound_enabled").default(true).notNull(),
  reducedMotion: boolean("reduced_motion").default(false).notNull(),
  createdAt,
  updatedAt,
});
export const consents = pgTable(
  "consents",
  {
    id,
    userId: userId(),
    policy: text("policy").notNull(),
    policyVersion: text("policy_version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("consent_active_policy_version_unique")
      .on(table.userId, table.policy, table.policyVersion)
      .where(sql`${table.withdrawnAt} is null`),
  ],
);
export const birthProfiles = pgTable(
  "birth_profiles",
  {
    id,
    userId: userId(),
    encryptedPayload: text("encrypted_payload").notNull(),
    activeSnapshotId: uuid("active_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("birth_profiles_user_unique").on(table.userId)],
);
export const profileSnapshots = pgTable(
  "profile_snapshots",
  {
    id,
    userId: userId(),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => birthProfiles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    completeness: text("completeness").notNull(),
    derivedPayload: jsonb("derived_payload").notNull(),
    calculationVersions: jsonb("calculation_versions").notNull(),
    createdAt,
  },
  (table) => [uniqueIndex("profile_snapshot_version_unique").on(table.profileId, table.version)],
);
export const profileComponents = pgTable(
  "profile_components",
  {
    id,
    userId: userId(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => profileSnapshots.id, { onDelete: "cascade" }),
    system: text("system").notNull(),
    status: text("status").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("profile_component_snapshot_system_unique").on(table.snapshotId, table.system),
  ],
);
export const profileTraits = pgTable("profile_traits", {
  id,
  userId: userId(),
  snapshotId: uuid("snapshot_id")
    .notNull()
    .references(() => profileSnapshots.id, { onDelete: "cascade" }),
  domain: text("domain").notNull(),
  statement: text("statement").notNull(),
  provenance: jsonb("provenance").notNull(),
  createdAt,
});
export const relationshipProfiles = pgTable(
  "relationship_profiles",
  {
    id,
    userId: userId(),
    activeSnapshotId: uuid("active_snapshot_id"),
    createdAt,
    updatedAt,
  },
  (table) => [index("relationship_profiles_user_idx").on(table.userId)],
);
export const relationshipProfileSnapshots = pgTable(
  "relationship_profile_snapshots",
  {
    id,
    userId: userId(),
    relationshipProfileId: uuid("relationship_profile_id")
      .notNull()
      .references(() => relationshipProfiles.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    encryptedInput: text("encrypted_input").notNull(),
    encryptedCalculations: text("encrypted_calculations").notNull(),
    derivedPayload: jsonb("derived_payload").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("relationship_profile_snapshot_version_unique").on(
      table.relationshipProfileId,
      table.version,
    ),
    index("relationship_profile_snapshots_user_idx").on(table.userId),
  ],
);
export const decks = pgTable("decks", {
  id,
  version: text("version").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt,
});
export const cards = pgTable(
  "cards",
  {
    id: text("id").notNull(),
    deckVersion: text("deck_version")
      .notNull()
      .references(() => decks.version),
    payload: jsonb("payload").notNull(),
    createdAt,
  },
  (table) => [
    primaryKey({ columns: [table.id, table.deckVersion], name: "cards_id_deck_version_pk" }),
  ],
);
export const cardMeanings = pgTable(
  "card_meanings",
  {
    id,
    cardId: text("card_id").notNull(),
    deckVersion: text("deck_version").notNull(),
    contentVersion: text("content_version").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt,
  },
  (table) => [
    foreignKey({
      columns: [table.cardId, table.deckVersion],
      foreignColumns: [cards.id, cards.deckVersion],
      name: "card_meanings_card_deck_fk",
    }).onDelete("cascade"),
    uniqueIndex("card_meaning_content_unique").on(
      table.cardId,
      table.deckVersion,
      table.contentVersion,
    ),
  ],
);
export const spreads = pgTable(
  "spreads",
  {
    id: text("id").notNull(),
    version: text("version").notNull(),
    payload: jsonb("payload").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt,
  },
  (table) => [primaryKey({ columns: [table.id, table.version], name: "spreads_id_version_pk" })],
);
export const spreadPositions = pgTable(
  "spread_positions",
  {
    id,
    spreadId: text("spread_id").notNull(),
    spreadVersion: text("spread_version").notNull(),
    positionId: text("position_id").notNull(),
    displayOrder: integer("display_order").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt,
  },
  (table) => [
    foreignKey({
      columns: [table.spreadId, table.spreadVersion],
      foreignColumns: [spreads.id, spreads.version],
      name: "spread_positions_spread_version_fk",
    }).onDelete("cascade"),
    uniqueIndex("spread_position_unique").on(table.spreadId, table.spreadVersion, table.positionId),
  ],
);
export const readingSessions = pgTable(
  "reading_sessions",
  {
    id,
    userId: userId(),
    profileSnapshotId: uuid("profile_snapshot_id")
      .notNull()
      .references(() => profileSnapshots.id),
    spreadId: text("spread_id").notNull(),
    spreadVersion: text("spread_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    encryptedQuestion: text("encrypted_question").notNull(),
    encryptedRelatedPersonLens: text("encrypted_related_person_lens"),
    readingLens: jsonb("reading_lens").notNull(),
    configuration: jsonb("configuration"),
    questionClassification: jsonb("question_classification")
      .default(
        sql`'{"version":"question-classification-v1","topic":"general","horizon":"open","intent":"generalReflection","generalReading":false}'::jsonb`,
      )
      .notNull(),
    entitlementDecision: jsonb("entitlement_decision")
      .default(
        sql`'{"version":"reading-entitlement-v1","mode":"unlimited","outcome":"granted","entitlementClass":"standard","used":0,"limit":null,"remaining":null,"windowStartsAt":null,"windowEndsAt":null}'::jsonb`,
      )
      .notNull(),
    ritualProgress: jsonb("ritual_progress"),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .default(sql`now() + interval '24 hours'`)
      .notNull(),
    safetyClassification: text("safety_classification").notNull(),
    state: text("state").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      columns: [table.spreadId, table.spreadVersion],
      foreignColumns: [spreads.id, spreads.version],
      name: "reading_sessions_spread_version_fk",
    }),
    uniqueIndex("reading_sessions_user_idempotency_unique").on(table.userId, table.idempotencyKey),
  ],
);
export const readingDraws = pgTable("reading_draws", {
  id,
  userId: userId(),
  readingId: uuid("reading_id")
    .notNull()
    .unique()
    .references(() => readingSessions.id, { onDelete: "cascade" }),
  deckVersion: text("deck_version")
    .notNull()
    .references(() => decks.version),
  shuffleVersion: text("shuffle_version").notNull(),
  assignments: jsonb("assignments").notNull(),
  proof: jsonb("proof"),
  encryptedServerSeed: text("encrypted_server_seed"),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull(),
  createdAt,
});
export const readingOutputs = pgTable("reading_outputs", {
  id,
  userId: userId(),
  readingId: uuid("reading_id")
    .notNull()
    .references(() => readingSessions.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(),
  promptVersion: text("prompt_version").notNull(),
  contentVersion: text("content_version").notNull(),
  safetyPolicyVersion: text("safety_policy_version").default("legacy-unrecorded").notNull(),
  schemaVersion: text("schema_version").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt,
});
export const followUpQuestions = pgTable(
  "follow_up_questions",
  {
    id,
    userId: userId(),
    readingId: uuid("reading_id")
      .notNull()
      .references(() => readingSessions.id, { onDelete: "cascade" }),
    encryptedQuestion: text("encrypted_question").notNull(),
    output: jsonb("output"),
    providerId: text("provider_id").default("legacy-unrecorded").notNull(),
    promptVersion: text("prompt_version").default("legacy-unrecorded").notNull(),
    contentVersion: text("content_version").default("legacy-unrecorded").notNull(),
    safetyPolicyVersion: text("safety_policy_version").default("legacy-unrecorded").notNull(),
    schemaVersion: text("schema_version").default("legacy-unrecorded").notNull(),
    createdAt,
  },
  (table) => [index("follow_up_questions_reading_idx").on(table.readingId)],
);
export const readingFeedback = pgTable(
  "reading_feedback",
  {
    id,
    userId: userId(),
    readingId: uuid("reading_id")
      .notNull()
      .references(() => readingSessions.id, { onDelete: "cascade" }),
    kind: text("kind").default("experience").notNull(),
    resonance: integer("resonance"),
    helpfulness: integer("helpfulness"),
    outcomeStatus: text("outcome_status"),
    behaviorChanged: boolean("behavior_changed"),
    encryptedComment: text("encrypted_comment"),
    createdAt,
  },
  (table) => [
    check(
      "reading_feedback_rating_range",
      sql`(${table.resonance} is null or ${table.resonance} between 1 and 5)
        and (${table.helpfulness} is null or ${table.helpfulness} between 1 and 5)`,
    ),
    check(
      "reading_feedback_kind_contract",
      sql`(
        ${table.kind} = 'experience'
        and ${table.outcomeStatus} is null
        and ${table.behaviorChanged} is null
        and (${table.resonance} is not null or ${table.helpfulness} is not null or ${table.encryptedComment} is not null)
      ) or (
        ${table.kind} = 'outcome'
        and ${table.outcomeStatus} in ('occurred', 'partial', 'did_not_occur', 'unclear')
        and ${table.behaviorChanged} is not null
        and ${table.resonance} is null
        and ${table.helpfulness} is null
      )`,
    ),
  ],
);
export const products = pgTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt,
});
export const orders = pgTable(
  "orders",
  {
    id,
    userId: userId(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    profileSnapshotId: uuid("profile_snapshot_id").references(() => profileSnapshots.id, {
      onDelete: "set null",
    }),
    provider: text("provider").notNull(),
    providerSessionId: text("provider_session_id").notNull().unique(),
    idempotencyKey: text("idempotency_key").notNull(),
    encryptedReportSource: text("encrypted_report_source"),
    status: text("status").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("orders_user_idempotency_unique").on(table.userId, table.idempotencyKey)],
);
export const entitlements = pgTable("entitlements", {
  id,
  userId: userId(),
  productId: text("product_id")
    .notNull()
    .references(() => products.id),
  profileSnapshotId: uuid("profile_snapshot_id").references(() => profileSnapshots.id, {
    onDelete: "set null",
  }),
  orderId: uuid("order_id")
    .notNull()
    .unique()
    .references(() => orders.id),
  status: text("status").notNull(),
  createdAt,
});
export const paymentWebhookEvents = pgTable("payment_webhook_events", {
  id,
  providerEventId: text("provider_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
  attemptCount: integer("attempt_count").default(0).notNull(),
  lastFailureCode: text("last_failure_code"),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt,
});
export const reports = pgTable("reports", {
  id,
  userId: userId(),
  entitlementId: uuid("entitlement_id")
    .notNull()
    .unique()
    .references(() => entitlements.id),
  profileSnapshotId: uuid("profile_snapshot_id").references(() => profileSnapshots.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull(),
  templateVersion: text("template_version").notNull(),
  payload: jsonb("payload"),
  createdAt,
  updatedAt,
});
export const reportSections = pgTable("report_sections", {
  id,
  userId: userId(),
  reportId: uuid("report_id")
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  sectionKey: text("section_key").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt,
});

// The report source is a context-bound encrypted copy of derived profile
// output, never raw birth input. It lets a paid report finish even when the
// user deletes their private profile while the background job is pending.
// Subject-scoped request access and the cross-user worker policy are installed
// explicitly by the commerce migration, mirroring interpretation_jobs.
export const reportJobs = pgTable(
  "report_jobs",
  {
    id,
    userId: userId(),
    reportId: uuid("report_id")
      .notNull()
      .references(() => reports.id, { onDelete: "cascade" }),
    encryptedSource: text("encrypted_source"),
    status: text("status").notNull().default("pending"),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    lastError: text("last_error"),
    createdAt,
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("report_jobs_report_unique").on(table.reportId),
    index("report_jobs_claimable_idx").on(table.status, table.availableAt, table.lockExpiresAt),
  ],
);
export const promptVersions = pgTable("prompt_versions", {
  id,
  version: text("version").notNull().unique(),
  purpose: text("purpose").notNull(),
  createdAt,
});
export const calculationVersions = pgTable(
  "calculation_versions",
  {
    id,
    system: text("system").notNull(),
    version: text("version").notNull(),
    status: text("status").notNull(),
    createdAt,
  },
  (table) => [uniqueIndex("calculation_system_version_unique").on(table.system, table.version)],
);
export const contentVersions = pgTable(
  "content_versions",
  {
    id,
    contentType: text("content_type").notNull(),
    version: text("version").notNull(),
    createdAt,
  },
  (table) => [uniqueIndex("content_type_version_unique").on(table.contentType, table.version)],
);

export const runtimeConfigurationVersions = pgTable(
  "runtime_configuration_versions",
  {
    id,
    domain: text("domain").notNull(),
    version: integer("version").notNull(),
    status: text("status").default("draft").notNull(),
    payload: jsonb("payload").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex("runtime_configuration_domain_version_unique").on(table.domain, table.version),
    uniqueIndex("runtime_configuration_one_published")
      .on(table.domain)
      .where(sql`${table.status} = 'published'`),
    check(
      "runtime_configuration_domain",
      sql`${table.domain} in ('content', 'prompts', 'commerce', 'features', 'models')`,
    ),
    check(
      "runtime_configuration_status",
      sql`${table.status} in ('draft', 'approved', 'published', 'archived')`,
    ),
    check("runtime_configuration_payload_object", sql`jsonb_typeof(${table.payload}) = 'object'`),
    check(
      "runtime_configuration_independent_approval",
      sql`${table.approvedBy} is null or ${table.createdBy} is null or ${table.approvedBy} <> ${table.createdBy}`,
    ),
  ],
);

// Privacy-minimized first-party funnel evidence. Rows contain no user id,
// email, birth/profile data, question text, cards, report prose, URL, cookie,
// or arbitrary exception string. The application validates a closed event
// and property vocabulary before this app-only table is reached.
export const productEvents = pgTable(
  "product_events",
  {
    id,
    idempotencyKey: text("idempotency_key").notNull(),
    eventName: text("event_name").notNull(),
    properties: jsonb("properties").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("product_events_idempotency_unique").on(table.idempotencyKey),
    check("product_events_digest", sql`${table.idempotencyKey} ~ '^[0-9a-f]{64}$'`),
    check(
      "product_events_name",
      sql`${table.eventName} in (
        'landing_view', 'pricing_view', 'signup_started', 'consent_completed',
        'profile_started', 'profile_completed', 'reading_selected', 'question_submitted',
        'shuffle_started', 'draw_locked', 'card_revealed', 'result_viewed',
        'followup_submitted', 'feedback_submitted', 'reading_reopened',
        'outcome_invited', 'outcome_submitted', 'report_previewed', 'checkout_started',
        'purchase_completed', 'report_ready', 'report_viewed', 'auth_failed',
        'profile_failed', 'generation_completed', 'generation_failed', 'fallback_used',
        'payment_failed', 'job_retried'
      )`,
    ),
    check("product_events_properties_object", sql`jsonb_typeof(${table.properties}) = 'object'`),
    check(
      "product_events_property_vocabulary",
      sql`${table.properties} - array[
        'routeClass', 'referrerClass', 'deviceClass', 'locale', 'completeness',
        'birthplacePresent', 'birthTimePresent', 'spreadId', 'spreadVersion', 'cardCount',
        'topic', 'horizon', 'questionLength', 'generalReading', 'generationMode',
        'fallbackUsed', 'feedbackKind', 'outcomeStatus', 'behaviorChanged', 'ratingBand',
        'readingAgeBucket', 'productId', 'priceId', 'campaignClass', 'modelVersion',
        'provider', 'currency', 'priceMinor', 'statusClass', 'errorClass', 'durationBucket'
      ]::text[] = '{}'::jsonb`,
    ),
  ],
);
// Not user-row-scoped: keyed by an opaque hash rather than a subject, and
// must be visible/writable by the trusted server role regardless of which
// (if any) user a request is bound to. See migration 0006 for the RLS
// rationale shared with interpretation_jobs (migration 0007).
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    keyHash: text("key_hash").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").default(1).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.keyHash, table.windowStart] }),
    index("rate_limit_buckets_expires_at_idx").on(table.expiresAt),
  ],
);

// Subject-bound for the application role (migration 0008): the request path
// reaches only its own subject's rows, while the worker's inherently
// cross-user claim sweep runs as the owning connection role under the
// explicit interpretation_jobs_system policy.
export const interpretationJobs = pgTable(
  "interpretation_jobs",
  {
    id,
    userId: userId(),
    readingId: uuid("reading_id")
      .notNull()
      .references(() => readingSessions.id, { onDelete: "cascade" }),
    deduplicationKey: text("deduplication_key").notNull(),
    status: text("status").notNull().default("pending"),
    availableAt: timestamp("available_at", { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockExpiresAt: timestamp("lock_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    lastError: text("last_error"),
    createdAt,
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("interpretation_jobs_dedup_unique").on(table.deduplicationKey),
    index("interpretation_jobs_claimable_idx").on(
      table.status,
      table.availableAt,
      table.lockExpiresAt,
    ),
  ],
);

export const auditEvents = pgTable("audit_events", {
  id,
  userId: userId(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: jsonb("metadata").notNull(),
  createdAt,
});

// Deliberately user-less (migration 0010): audit_events cascade away with the
// user they belong to, so the evidence that a deletion happened must live in
// a row no cascade can reach. subject_hash is a domain-separated SHA-256 of
// the user id — enough to answer "was this subject deleted, when, under which
// policy" given the id, without retaining the id itself.
export const deletionReceipts = pgTable("deletion_receipts", {
  id,
  subjectHash: text("subject_hash").notNull(),
  policyVersion: text("policy_version").notNull(),
  requestedAt: timestamp("requested_at", { withTimezone: true }).defaultNow().notNull(),
});
