/**
 * Ordered authoritative migration history.
 *
 * Staging verification and integrity tests share this manifest so adding a
 * migration cannot update one gate while silently leaving the other behind.
 */
export const EXPECTED_MIGRATIONS = [
  "0000_busy_centennial",
  "0001_supabase_staging",
  "0002_remove_auth_user_sync_trigger",
  "0003_webhook_replay_lease",
  "0004_server_actor_role",
  "0005_bumpy_moon_knight",
  "0006_rate_limit_buckets",
  "0007_interpretation_jobs",
  "0008_interpretation_jobs_subject_rls",
  "0009_profile_snapshot_immutability",
  "0010_deletion_receipts",
  "0011_reading_flow_controls",
  "0012_commerce_report_jobs",
  "0013_checkout_report_source",
] as const;
