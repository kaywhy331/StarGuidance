import type {
  FollowUpResult,
  ProfileSnapshot,
  ProfileTrait,
  QuestionClassification,
  ReadingConfiguration,
  ReadingEntitlementDecision,
  ReadingOutputProvenance,
  ReadingResult,
  StoredRitualProgress,
} from "@starguidance/contracts";
import type { LockedDraw } from "@starguidance/tarot-domain";

export interface RepositoryUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface UserSettingsRecord {
  userId: string;
  displayName: string;
  soundEnabled: boolean;
  reducedMotion: boolean;
}

export interface ConsentRecord {
  policy: string;
  version: string;
  grantedAt: string;
  withdrawnAt?: string;
}

export interface StoredProfileVersion {
  encryptedInput: string;
  encryptedCalculations: string;
  components?: readonly Omit<ProfileComponentRecord, "snapshotId">[];
  snapshot: ProfileSnapshot;
}

/** A private, versioned profile for a person the account owner knows. Raw
 * birth inputs and full calculations remain encrypted; only the normalized
 * snapshot is available to server-side lens selection. */
export interface StoredRelationshipProfileVersion extends StoredProfileVersion {
  relationshipProfileId: string;
}

export interface ProfileComponentRecord {
  snapshotId: string;
  system: string;
  status: "implemented" | "unavailable" | "pending-certification";
  payload: unknown;
}

export interface ProfileTraitRecord {
  snapshotId: string;
  trait: ProfileTrait;
}

export interface ReadingLensRecord {
  version: string;
  traitIndexes: readonly number[];
  tensionIndexes?: readonly number[] | undefined;
}

export interface StoredFollowUp {
  id: string;
  encryptedQuestion: string;
  result: FollowUpResult;
  outputProvenance: ReadingOutputProvenance;
  createdAt: string;
}

export interface StoredFeedback {
  id: string;
  userId: string;
  readingId: string;
  kind: "experience" | "outcome";
  resonance?: number;
  helpfulness?: number;
  outcomeStatus?: "occurred" | "partial" | "did_not_occur" | "unclear";
  behaviorChanged?: boolean;
  encryptedComment?: string;
  createdAt: string;
}

export interface StoredReading {
  id: string;
  userId: string;
  idempotencyKey: string;
  profileSnapshotId: string;
  readingLens: ReadingLensRecord;
  questionClassification: QuestionClassification;
  entitlementDecision: ReadingEntitlementDecision;
  ritualProgress?: StoredRitualProgress;
  expiresAt: string;
  spreadId: string;
  configuration: ReadingConfiguration;
  encryptedQuestion: string;
  encryptedRelatedPersonLens?: string;
  encryptedServerSeed?: string;
  safetyClassification: string;
  draw: LockedDraw;
  result?: ReadingResult;
  outputProvenance?: ReadingOutputProvenance;
  generationStatus: "pending" | "ready" | "failed";
  followUps: StoredFollowUp[];
  createdAt: string;
}

export interface StoredReportSection {
  key: string;
  title: string;
  body: string;
  unavailable?: boolean;
}

export interface StoredReport {
  id: string;
  userId: string;
  snapshotId: string | null;
  orderId: string;
  provider: "local" | "stripe";
  status: "pending" | "ready" | "failed";
  sections: StoredReportSection[];
  createdAt: string;
}

export interface StoredOrder {
  id: string;
  userId: string;
  snapshotId: string | null;
  provider: "local" | "stripe";
  providerSessionId: string;
  idempotencyKey: string;
  status: "pending" | "paid" | "failed" | "refunded" | "disputed";
  createdAt: string;
}

export interface StoredEntitlement {
  id: string;
  userId: string;
  snapshotId: string | null;
  orderId: string;
  status: "active" | "revoked";
  createdAt: string;
}

export interface AuditRecord {
  action: string;
  userId: string;
  targetType: string;
  targetId: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export interface UserRepository {
  ensure(user: Pick<RepositoryUser, "id" | "email">): Promise<RepositoryUser>;
  get(userId: string): Promise<RepositoryUser | undefined>;
  delete(userId: string): Promise<void>;
}

export interface SettingsRepository {
  get(userId: string): Promise<UserSettingsRecord | undefined>;
  upsert(record: UserSettingsRecord): Promise<void>;
}

export interface ConsentRepository {
  list(userId: string): Promise<ConsentRecord[]>;
  grant(userId: string, consent: ConsentRecord): Promise<void>;
  withdraw(userId: string, policy: string, withdrawnAt: string): Promise<boolean>;
}

export interface BirthProfileRepository {
  getActive(userId: string): Promise<StoredProfileVersion | undefined>;
  saveVersion(userId: string, profile: StoredProfileVersion): Promise<ProfileSnapshot>;
  listVersions(userId: string): Promise<StoredProfileVersion[]>;
  delete(userId: string): Promise<boolean>;
}

export interface RelationshipProfileRepository {
  getActive(
    userId: string,
    relationshipProfileId: string,
  ): Promise<StoredRelationshipProfileVersion | undefined>;
  getSnapshot(
    userId: string,
    snapshotId: string,
  ): Promise<StoredRelationshipProfileVersion | undefined>;
  listActive(userId: string): Promise<StoredRelationshipProfileVersion[]>;
  listVersions(
    userId: string,
    relationshipProfileId?: string,
  ): Promise<StoredRelationshipProfileVersion[]>;
  saveVersion(userId: string, profile: StoredRelationshipProfileVersion): Promise<ProfileSnapshot>;
  delete(userId: string, relationshipProfileId: string): Promise<boolean>;
}

export interface ProfileSnapshotRepository {
  get(userId: string, snapshotId: string): Promise<StoredProfileVersion | undefined>;
  list(userId: string): Promise<ProfileSnapshot[]>;
}

export interface ProfileComponentRepository {
  list(userId: string, snapshotId: string): Promise<ProfileComponentRecord[]>;
}

export interface TraitRepository {
  list(userId: string, snapshotId: string): Promise<ProfileTraitRecord[]>;
}

export interface ReadingSessionRepository {
  createLocked(reading: StoredReading): Promise<StoredReading>;
  get(userId: string, readingId: string): Promise<StoredReading | undefined>;
  list(userId: string): Promise<StoredReading[]>;
  delete(userId: string, readingId: string): Promise<boolean>;
  setGenerationStatus(
    userId: string,
    readingId: string,
    status: StoredReading["generationStatus"],
  ): Promise<void>;
  updateRitualProgress(
    userId: string,
    readingId: string,
    progress: StoredRitualProgress,
  ): Promise<void>;
}

export interface LockedDrawRepository {
  get(userId: string, readingId: string): Promise<LockedDraw | undefined>;
}

export interface ReadingOutputRepository {
  save(
    userId: string,
    readingId: string,
    result: ReadingResult,
    provenance: ReadingOutputProvenance,
  ): Promise<void>;
  latest(userId: string, readingId: string): Promise<ReadingResult | undefined>;
}

export interface FollowUpRepository {
  list(userId: string, readingId: string): Promise<StoredFollowUp[]>;
  create(
    userId: string,
    readingId: string,
    followUp: StoredFollowUp,
    policy: { limit: number },
  ): Promise<void>;
}

export interface HistoryRepository {
  listReadings(userId: string): Promise<StoredReading[]>;
}

export interface FeedbackRepository {
  create(input: {
    userId: string;
    readingId: string;
    kind: StoredFeedback["kind"];
    resonance?: number;
    helpfulness?: number;
    outcomeStatus?: StoredFeedback["outcomeStatus"];
    behaviorChanged?: boolean;
    encryptedComment?: string;
  }): Promise<StoredFeedback>;
  list(userId: string, readingId?: string): Promise<StoredFeedback[]>;
}

export interface ReportRepository {
  get(userId: string, reportId: string): Promise<StoredReport | undefined>;
  getByOrder(userId: string, orderId: string): Promise<StoredReport | undefined>;
  create(report: StoredReport): Promise<void>;
  list(userId: string): Promise<StoredReport[]>;
  listForExport(userId: string): Promise<StoredReport[]>;
}

export interface OrderRepository {
  create(order: StoredOrder, encryptedReportSource?: string): Promise<void>;
  get(userId: string, orderId: string): Promise<StoredOrder | undefined>;
  getByIdempotencyKey(userId: string, key: string): Promise<StoredOrder | undefined>;
  getByProviderSession(providerSessionId: string): Promise<StoredOrder | undefined>;
  getByProviderReference(orderId: string): Promise<StoredOrder | undefined>;
  replaceProviderSession(
    userId: string,
    orderId: string,
    expectedProviderSessionId: string,
    providerSessionId: string,
  ): Promise<boolean>;
  clearReportSource(orderId: string): Promise<void>;
  setStatus(orderId: string, status: StoredOrder["status"]): Promise<void>;
  list(userId: string): Promise<StoredOrder[]>;
}

export interface ReportFulfillmentRepository {
  enqueuePaid(input: {
    orderId: string;
    userId: string;
    snapshotId: string | null;
    reportId: string;
    entitlementId: string;
    createdAt: string;
  }): Promise<StoredReport>;
}

export interface EntitlementRepository {
  grant(entitlement: StoredEntitlement): Promise<void>;
  revokeByOrder(orderId: string): Promise<void>;
  list(userId: string): Promise<StoredEntitlement[]>;
}

export interface WebhookEventRepository {
  begin(providerEventId: string, eventType: string): Promise<boolean>;
  complete(providerEventId: string): Promise<void>;
  fail(providerEventId: string, failureCode: string): Promise<void>;
}

export interface AuditRepository {
  record(record: Omit<AuditRecord, "createdAt">): Promise<void>;
  list(userId: string): Promise<AuditRecord[]>;
}

export interface PrivacyRepository {
  export(userId: string): Promise<{
    user: RepositoryUser;
    settings?: UserSettingsRecord;
    consents: ConsentRecord[];
    profiles: StoredProfileVersion[];
    relationshipProfiles: StoredRelationshipProfileVersion[];
    readings: StoredReading[];
    feedback: StoredFeedback[];
    reports: StoredReport[];
    orders: StoredOrder[];
    entitlements: StoredEntitlement[];
    auditEvents: AuditRecord[];
  }>;
  deleteAccount(userId: string): Promise<void>;
}

export interface ApplicationRepositories {
  users: UserRepository;
  settings: SettingsRepository;
  consents: ConsentRepository;
  birthProfiles: BirthProfileRepository;
  relationshipProfiles: RelationshipProfileRepository;
  profileSnapshots: ProfileSnapshotRepository;
  profileComponents: ProfileComponentRepository;
  traits: TraitRepository;
  readingSessions: ReadingSessionRepository;
  lockedDraws: LockedDrawRepository;
  outputs: ReadingOutputRepository;
  followUps: FollowUpRepository;
  history: HistoryRepository;
  feedback: FeedbackRepository;
  reports: ReportRepository;
  reportFulfillment: ReportFulfillmentRepository;
  orders: OrderRepository;
  entitlements: EntitlementRepository;
  webhookEvents: WebhookEventRepository;
  audit: AuditRepository;
  privacy: PrivacyRepository;
}
