/*
 * Lets a reader explicitly save their free guest reading into account history.
 *
 * A guest reading is drawn before any account or private profile exists, so a
 * saved copy can never point at a profile snapshot. Instead of weakening that
 * lineage for account readings, every row now names its source and the check
 * below keeps the two shapes apart: account readings still require their
 * immutable snapshot, and a saved guest reading has neither a snapshot nor a
 * related-person lens. Existing rows are all account readings with a snapshot,
 * so the default and the constraint hold for them unchanged. Table grants and
 * forced RLS on reading_sessions already cover the new column.
 */
ALTER TABLE "reading_sessions" ALTER COLUMN "profile_snapshot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "source" text DEFAULT 'account' NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_source_contract" CHECK (("reading_sessions"."source" = 'account' and "reading_sessions"."profile_snapshot_id" is not null)
        or (
          "reading_sessions"."source" = 'guest_trial'
          and "reading_sessions"."profile_snapshot_id" is null
          and "reading_sessions"."encrypted_related_person_lens" is null
        ));
