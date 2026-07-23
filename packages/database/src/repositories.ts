import type {
  BirthProfileInput,
  ProfileSnapshot,
  ProfileTrait,
  ReadingResult,
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
}

export interface StoredProfileVersion {
  encryptedInput: string;
  encryptedCalculations: string;
  snapshot: ProfileSnapshot;
  maskedName: string;
  birthDate: string;
  timeKind: BirthProfileInput["birthTime"]["kind"];
  birthplaceLabel?: string;
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
}

export interface StoredFollowUp {
  id: string;
  encryptedQuestion: string;
  result: ReadingResult;
  createdAt: string;
}

export interface StoredReading {
  id: string;
  userId: string;
  profileSnapshotId: string;
  readingLens: ReadingLensRecord;
  spreadId: string;
  encryptedQuestion: string;
  safetyClassification: string;
  draw: LockedDraw;
  result?: ReadingResult;
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
  snapshotId: string;
  orderId: string;
  status: "pending" | "ready" | "failed";
  sections: StoredReportSection[];
  createdAt: string;
}

export interface StoredOrder {
  id: string;
  userId: string;
  snapshotId: string;
  provider: "local" | "stripe";
  providerSessionId: string;
  idempotencyKey: string;
  status: "pending" | "paid" | "failed" | "refunded";
  createdAt: string;
}

export interface StoredEntitlement {
  id: string;
  userId: string;
  snapshotId: string;
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
}

export interface BirthProfileRepository {
  getActive(userId: string): Promise<StoredProfileVersion | undefined>;
  saveVersion(userId: string, profile: StoredProfileVersion): Promise<void>;
  listVersions(userId: string): Promise<StoredProfileVersion[]>;
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
  createLocked(reading: StoredReading): Promise<void>;
  get(userId: string, readingId: string): Promise<StoredReading | undefined>;
  list(userId: string): Promise<StoredReading[]>;
  setGenerationStatus(
    userId: string,
    readingId: string,
    status: StoredReading["generationStatus"],
  ): Promise<void>;
}

export interface LockedDrawRepository {
  get(userId: string, readingId: string): Promise<LockedDraw | undefined>;
}

export interface ReadingOutputRepository {
  save(userId: string, readingId: string, result: ReadingResult): Promise<void>;
  latest(userId: string, readingId: string): Promise<ReadingResult | undefined>;
}

export interface FollowUpRepository {
  list(userId: string, readingId: string): Promise<StoredFollowUp[]>;
  create(userId: string, readingId: string, followUp: StoredFollowUp): Promise<void>;
}

export interface HistoryRepository {
  listReadings(userId: string): Promise<StoredReading[]>;
}

export interface FeedbackRepository {
  create(input: {
    userId: string;
    readingId: string;
    resonance?: number;
    helpfulness?: number;
    encryptedComment?: string;
  }): Promise<string>;
}

export interface ReportRepository {
  get(userId: string, reportId: string): Promise<StoredReport | undefined>;
  create(report: StoredReport): Promise<void>;
  list(userId: string): Promise<StoredReport[]>;
}

export interface OrderRepository {
  create(order: StoredOrder): Promise<void>;
  get(userId: string, orderId: string): Promise<StoredOrder | undefined>;
  getByIdempotencyKey(userId: string, key: string): Promise<StoredOrder | undefined>;
  getByProviderSession(providerSessionId: string): Promise<StoredOrder | undefined>;
  setStatus(orderId: string, status: StoredOrder["status"]): Promise<void>;
  list(userId: string): Promise<StoredOrder[]>;
}

export interface EntitlementRepository {
  grant(entitlement: StoredEntitlement): Promise<void>;
  list(userId: string): Promise<StoredEntitlement[]>;
}

export interface WebhookEventRepository {
  begin(providerEventId: string, eventType: string): Promise<boolean>;
  complete(providerEventId: string): Promise<void>;
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
    readings: StoredReading[];
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
  orders: OrderRepository;
  entitlements: EntitlementRepository;
  webhookEvents: WebhookEventRepository;
  audit: AuditRepository;
  privacy: PrivacyRepository;
}
