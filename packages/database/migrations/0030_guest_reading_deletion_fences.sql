/*
 * Keeps a deleted saved guest reading deleted until its guest receipt expires.
 *
 * A guest receipt is a stateless bearer artifact, valid for seven days and
 * identical before and after its history entry is deleted. Deletion removes
 * every row of the reading, so a save that was delayed in flight or replayed
 * from another copy of the receipt used to import the reading again. The
 * delete statement now leaves one fence row, committed with the removal: a
 * domain-separated SHA-256 of the reading id and the receipt's own expiry.
 * Import checks it after its own insert, in the same transaction and under a
 * per-reading transaction lock the delete also holds, so a save that raced
 * the delete either returned the still-saved reading or sees the fence and
 * rolls back. Only an unexpired fence blocks a save.
 *
 * No owner, reading content or other timestamp is kept. A fence outlives its
 * receipt by at most the next system prune (expired rows are garbage by
 * definition: an expired receipt is refused before any import).
 *
 * Access posture: the application role may read a fence and append one; it
 * can neither change nor remove one. The owning connection role prunes
 * expired rows under the explicit system policy (the deletion_receipts
 * pattern, migration 0010). Browser roles and PUBLIC have no access.
 */
CREATE TABLE "guest_reading_deletion_fences" (
	"reading_hash" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "guest_reading_deletion_fences_expires_at_idx" ON "guest_reading_deletion_fences" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "guest_reading_deletion_fences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guest_reading_deletion_fences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "guest_reading_deletion_fences_app" ON "guest_reading_deletion_fences" FOR ALL TO starguidance_app
  USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "guest_reading_deletion_fences_system" ON "guest_reading_deletion_fences" FOR ALL TO CURRENT_USER
  USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON TABLE "guest_reading_deletion_fences" FROM PUBLIC, authenticated;--> statement-breakpoint
DO $anon_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE guest_reading_deletion_fences FROM anon';
  END IF;
END
$anon_guard$;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "guest_reading_deletion_fences" TO starguidance_app;
