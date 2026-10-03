/*
 * Binds every follow-up to a reading owned by the same account.
 *
 * Forced RLS checks only a row's own user_id, and the existing reading_id
 * foreign key is verified without RLS, so an account could store a follow-up of
 * its own that points at another account's reading. The composite key below
 * makes the engine refuse that on insert and on any change to reading_id or
 * user_id, while same-account follow-ups, the existing reading_id cascade, and
 * the one-reading row lock are unchanged.
 *
 * The key is added NOT VALID: it applies to every new or re-pointed row from
 * this migration on, but does not scan or rewrite rows that already exist.
 * Any pre-existing cross-account rows are left in place for an explicit
 * decision; `VALIDATE CONSTRAINT` belongs to a later migration once that
 * decision is made and fails, without changing data, while such a row remains.
 */
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_id_user_unique" UNIQUE("id","user_id");--> statement-breakpoint
ALTER TABLE "follow_up_questions" ADD CONSTRAINT "follow_up_questions_reading_owner_fk" FOREIGN KEY ("reading_id","user_id") REFERENCES "public"."reading_sessions"("id","user_id") ON DELETE cascade ON UPDATE no action NOT VALID;
