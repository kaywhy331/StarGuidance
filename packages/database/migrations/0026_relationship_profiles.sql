CREATE TABLE "relationship_profile_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"relationship_profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"encrypted_input" text NOT NULL,
	"encrypted_calculations" text NOT NULL,
	"derived_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "relationship_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"active_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "encrypted_related_person_lens" text;--> statement-breakpoint
ALTER TABLE "relationship_profile_snapshots" ADD CONSTRAINT "relationship_profile_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_profile_snapshots" ADD CONSTRAINT "relationship_profile_snapshots_relationship_profile_id_relationship_profiles_id_fk" FOREIGN KEY ("relationship_profile_id") REFERENCES "public"."relationship_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relationship_profiles" ADD CONSTRAINT "relationship_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "relationship_profile_snapshot_version_unique" ON "relationship_profile_snapshots" USING btree ("relationship_profile_id","version");--> statement-breakpoint
CREATE INDEX "relationship_profile_snapshots_user_idx" ON "relationship_profile_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "relationship_profiles_user_idx" ON "relationship_profiles" USING btree ("user_id");
--> statement-breakpoint
ALTER TABLE "relationship_profiles" ADD CONSTRAINT "relationship_profiles_active_snapshot_id_fk"
  FOREIGN KEY ("active_snapshot_id") REFERENCES "public"."relationship_profile_snapshots"("id")
  ON DELETE SET NULL ON UPDATE no action;
--> statement-breakpoint

/* Birth details for people known by an account owner have the same hard
 * server-only boundary as the owner's profile. Browser roles receive no table
 * privileges; the application role is still constrained to the bound subject. */
ALTER TABLE "relationship_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "relationship_profiles" FORCE ROW LEVEL SECURITY;
ALTER TABLE "relationship_profile_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "relationship_profile_snapshots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE "relationship_profiles", "relationship_profile_snapshots"
  FROM PUBLIC, authenticated;
--> statement-breakpoint
DO $anon_revoke$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "relationship_profiles", "relationship_profile_snapshots" FROM anon;
  END IF;
END
$anon_revoke$;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "relationship_profiles" TO starguidance_app;
GRANT SELECT, INSERT ON TABLE "relationship_profile_snapshots" TO starguidance_app;
GRANT UPDATE ("encrypted_input", "encrypted_calculations")
  ON TABLE "relationship_profile_snapshots" TO starguidance_app;
--> statement-breakpoint
CREATE POLICY "relationship_profiles_owner" ON "relationship_profiles" FOR ALL TO starguidance_app
  USING ("user_id" = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid);
--> statement-breakpoint
CREATE POLICY "relationship_profile_snapshots_owner" ON "relationship_profile_snapshots"
  FOR ALL TO starguidance_app
  USING ("user_id" = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid)
  WITH CHECK ("user_id" = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid);
--> statement-breakpoint
DO $relationship_profile_guard$
BEGIN
  IF has_table_privilege('authenticated', 'public.relationship_profiles', 'SELECT')
    OR has_table_privilege('authenticated', 'public.relationship_profiles', 'INSERT')
    OR has_table_privilege('authenticated', 'public.relationship_profiles', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.relationship_profiles', 'DELETE')
    OR has_table_privilege('authenticated', 'public.relationship_profile_snapshots', 'SELECT')
    OR has_table_privilege('authenticated', 'public.relationship_profile_snapshots', 'INSERT')
    OR has_table_privilege('authenticated', 'public.relationship_profile_snapshots', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.relationship_profile_snapshots', 'DELETE') THEN
    RAISE EXCEPTION 'browser role retains access to private relationship profiles';
  END IF;
  IF NOT (
    has_table_privilege('starguidance_app', 'public.relationship_profiles', 'SELECT')
    AND has_table_privilege('starguidance_app', 'public.relationship_profile_snapshots', 'SELECT')
    AND has_table_privilege('starguidance_app', 'public.relationship_profile_snapshots', 'INSERT')
    AND NOT has_table_privilege('starguidance_app', 'public.relationship_profile_snapshots', 'UPDATE')
    AND NOT has_table_privilege('starguidance_app', 'public.relationship_profile_snapshots', 'DELETE')
    AND has_column_privilege('starguidance_app', 'public.relationship_profile_snapshots', 'encrypted_input', 'UPDATE')
    AND has_column_privilege('starguidance_app', 'public.relationship_profile_snapshots', 'encrypted_calculations', 'UPDATE')
    AND NOT has_column_privilege('starguidance_app', 'public.relationship_profile_snapshots', 'derived_payload', 'UPDATE')
    AND NOT has_column_privilege('starguidance_app', 'public.relationship_profile_snapshots', 'version', 'UPDATE')
  ) THEN
    RAISE EXCEPTION 'application role lacks relationship-profile access';
  END IF;
END
$relationship_profile_guard$;
