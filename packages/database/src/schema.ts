import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();
const id = uuid("id").defaultRandom().primaryKey();
const userId = uuid("user_id").notNull();

export const users = pgTable("users", { id, email: text("email").notNull().unique(), createdAt });
export const userSettings = pgTable("user_settings", {
  id,
  userId: userId.unique(),
  displayName: text("display_name").notNull(),
  soundEnabled: boolean("sound_enabled").default(false).notNull(),
  reducedMotion: boolean("reduced_motion").default(false).notNull(),
  createdAt,
  updatedAt,
});
export const consents = pgTable("consents", {
  id,
  userId,
  policy: text("policy").notNull(),
  policyVersion: text("policy_version").notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
});
export const birthProfiles = pgTable("birth_profiles", {
  id,
  userId,
  encryptedPayload: text("encrypted_payload").notNull(),
  activeSnapshotId: uuid("active_snapshot_id"),
  createdAt,
  updatedAt,
});
export const profileSnapshots = pgTable(
  "profile_snapshots",
  {
    id,
    userId,
    profileId: uuid("profile_id").notNull(),
    version: integer("version").notNull(),
    completeness: text("completeness").notNull(),
    derivedPayload: jsonb("derived_payload").notNull(),
    calculationVersions: jsonb("calculation_versions").notNull(),
    createdAt,
  },
  (table) => [uniqueIndex("profile_snapshot_version_unique").on(table.profileId, table.version)],
);
export const profileComponents = pgTable("profile_components", {
  id,
  userId,
  snapshotId: uuid("snapshot_id").notNull(),
  system: text("system").notNull(),
  status: text("status").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt,
});
export const profileTraits = pgTable("profile_traits", {
  id,
  userId,
  snapshotId: uuid("snapshot_id").notNull(),
  domain: text("domain").notNull(),
  statement: text("statement").notNull(),
  provenance: jsonb("provenance").notNull(),
  createdAt,
});
export const decks = pgTable("decks", {
  id,
  version: text("version").notNull().unique(),
  name: text("name").notNull(),
  createdAt,
});
export const cards = pgTable("cards", {
  id: text("id").primaryKey(),
  deckVersion: text("deck_version").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt,
});
export const cardMeanings = pgTable("card_meanings", {
  id,
  cardId: text("card_id").notNull(),
  contentVersion: text("content_version").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt,
});
export const spreads = pgTable("spreads", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt,
});
export const spreadPositions = pgTable("spread_positions", {
  id,
  spreadId: text("spread_id").notNull(),
  positionId: text("position_id").notNull(),
  displayOrder: integer("display_order").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt,
});
export const readingSessions = pgTable("reading_sessions", {
  id,
  userId,
  profileSnapshotId: uuid("profile_snapshot_id").notNull(),
  spreadId: text("spread_id").notNull(),
  spreadVersion: text("spread_version").notNull(),
  encryptedQuestion: text("encrypted_question").notNull(),
  safetyClassification: text("safety_classification").notNull(),
  state: text("state").notNull(),
  createdAt,
  updatedAt,
});
export const readingDraws = pgTable("reading_draws", {
  id,
  userId,
  readingId: uuid("reading_id").notNull().unique(),
  deckVersion: text("deck_version").notNull(),
  shuffleVersion: text("shuffle_version").notNull(),
  assignments: jsonb("assignments").notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }).notNull(),
  createdAt,
});
export const readingOutputs = pgTable("reading_outputs", {
  id,
  userId,
  readingId: uuid("reading_id").notNull(),
  providerId: text("provider_id").notNull(),
  promptVersion: text("prompt_version").notNull(),
  contentVersion: text("content_version").notNull(),
  schemaVersion: text("schema_version").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt,
});
export const followUpQuestions = pgTable("follow_up_questions", {
  id,
  userId,
  readingId: uuid("reading_id").notNull(),
  encryptedQuestion: text("encrypted_question").notNull(),
  output: jsonb("output"),
  createdAt,
});
export const readingFeedback = pgTable("reading_feedback", {
  id,
  userId,
  readingId: uuid("reading_id").notNull(),
  resonance: integer("resonance"),
  helpfulness: integer("helpfulness"),
  encryptedComment: text("encrypted_comment"),
  createdAt,
});
export const products = pgTable("products", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt,
});
export const orders = pgTable("orders", {
  id,
  userId,
  productId: text("product_id").notNull(),
  provider: text("provider").notNull(),
  providerSessionId: text("provider_session_id").notNull().unique(),
  status: text("status").notNull(),
  createdAt,
  updatedAt,
});
export const entitlements = pgTable("entitlements", {
  id,
  userId,
  productId: text("product_id").notNull(),
  profileSnapshotId: uuid("profile_snapshot_id").notNull(),
  orderId: uuid("order_id").notNull().unique(),
  status: text("status").notNull(),
  createdAt,
});
export const paymentWebhookEvents = pgTable("payment_webhook_events", {
  id,
  providerEventId: text("provider_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  createdAt,
});
export const reports = pgTable("reports", {
  id,
  userId,
  entitlementId: uuid("entitlement_id").notNull().unique(),
  profileSnapshotId: uuid("profile_snapshot_id").notNull(),
  status: text("status").notNull(),
  templateVersion: text("template_version").notNull(),
  payload: jsonb("payload"),
  createdAt,
  updatedAt,
});
export const reportSections = pgTable("report_sections", {
  id,
  userId,
  reportId: uuid("report_id").notNull(),
  sectionKey: text("section_key").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt,
});
export const promptVersions = pgTable("prompt_versions", {
  id,
  version: text("version").notNull().unique(),
  purpose: text("purpose").notNull(),
  createdAt,
});
export const calculationVersions = pgTable("calculation_versions", {
  id,
  system: text("system").notNull(),
  version: text("version").notNull(),
  status: text("status").notNull(),
  createdAt,
});
export const contentVersions = pgTable("content_versions", {
  id,
  contentType: text("content_type").notNull(),
  version: text("version").notNull(),
  createdAt,
});
export const auditEvents = pgTable("audit_events", {
  id,
  userId,
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  metadata: jsonb("metadata").notNull(),
  createdAt,
});
