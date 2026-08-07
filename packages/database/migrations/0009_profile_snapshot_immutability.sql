/*
 * Enforce profile-snapshot immutability in the database (gap G11).
 *
 * docs/KNOWN-GAPS.md described the snapshot boundary as application-enforced:
 * nothing in the application updates or deletes a snapshot, but migration 0004
 * granted starguidance_app full UPDATE/DELETE on the lineage tables, so the
 * "immutable snapshot" claim rested entirely on code discipline. Two layers
 * close that:
 *
 * - A BEFORE UPDATE guard trigger on profile_snapshots rejects every update,
 *   from every role including the table owner. Snapshots version forward
 *   (profile_snapshot_version_unique) — a corrected calculation is a new
 *   version, never an edit, so readings keep pointing at exactly what they
 *   were drawn against.
 * - UPDATE and DELETE grants are revoked from starguidance_app on all three
 *   lineage tables (profile_snapshots, profile_components, profile_traits).
 *   Rows leave only via the enforced FK cascades (user deletion, profile
 *   deletion), which run with the table owner's rights and are unaffected.
 *
 * profile_components deliberately gets NO update trigger: the key-rotation
 * tool (packages/database/scripts/rotate-encryption-key.ts) re-encrypts the
 * private-calculation envelopes in place on the connection role. Rotation
 * replaces ciphertext for the same plaintext — the snapshot's content
 * lineage is unchanged — so the owner-role path stays open there while the
 * application role loses it.
 */
CREATE FUNCTION profile_snapshots_forbid_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'profile_snapshots rows are immutable; insert a new version instead'
    USING ERRCODE = 'restrict_violation';
END
$$;--> statement-breakpoint
CREATE TRIGGER profile_snapshots_immutable
  BEFORE UPDATE ON profile_snapshots
  FOR EACH ROW EXECUTE FUNCTION profile_snapshots_forbid_update();--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE profile_snapshots FROM starguidance_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE profile_components FROM starguidance_app;--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE profile_traits FROM starguidance_app;
