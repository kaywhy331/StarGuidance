CREATE TABLE "runtime_configuration_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"domain" text NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runtime_configuration_domain" CHECK ("runtime_configuration_versions"."domain" in ('content', 'prompts', 'commerce', 'features', 'models')),
	CONSTRAINT "runtime_configuration_status" CHECK ("runtime_configuration_versions"."status" in ('draft', 'approved', 'published', 'archived')),
	CONSTRAINT "runtime_configuration_payload_object" CHECK (jsonb_typeof("runtime_configuration_versions"."payload") = 'object'),
	CONSTRAINT "runtime_configuration_independent_approval" CHECK ("runtime_configuration_versions"."approved_by" is null or "runtime_configuration_versions"."created_by" is null or "runtime_configuration_versions"."approved_by" <> "runtime_configuration_versions"."created_by")
);
--> statement-breakpoint
ALTER TABLE "runtime_configuration_versions" ADD CONSTRAINT "runtime_configuration_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtime_configuration_versions" ADD CONSTRAINT "runtime_configuration_versions_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_configuration_domain_version_unique" ON "runtime_configuration_versions" USING btree ("domain","version");--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_configuration_one_published" ON "runtime_configuration_versions" USING btree ("domain") WHERE "runtime_configuration_versions"."status" = 'published';--> statement-breakpoint

CREATE FUNCTION protect_runtime_configuration_release() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.domain IS DISTINCT FROM OLD.domain
    OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.payload IS DISTINCT FROM OLD.payload
    OR (
      NEW.created_by IS DISTINCT FROM OLD.created_by
      AND NOT (OLD.created_by IS NOT NULL AND NEW.created_by IS NULL)
    )
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'runtime configuration release identity and payload are immutable';
  END IF;
  IF NOT (
    NEW.status = OLD.status
    OR (OLD.status = 'draft' AND NEW.status = 'approved')
    OR (OLD.status = 'approved' AND NEW.status = 'published')
    OR (OLD.status = 'published' AND NEW.status = 'archived')
    OR (OLD.status = 'archived' AND NEW.status = 'published')
  ) THEN
    RAISE EXCEPTION 'invalid runtime configuration release transition';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER runtime_configuration_release_immutable
BEFORE UPDATE ON "runtime_configuration_versions"
FOR EACH ROW EXECUTE FUNCTION protect_runtime_configuration_release();--> statement-breakpoint

/*
 * Runtime configuration is a trusted control plane, never a browser-facing
 * table. The application role can append and transition versions; deletion is
 * intentionally absent so rollback and actor evidence remain recoverable.
 */
ALTER TABLE "runtime_configuration_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "runtime_configuration_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "runtime_configuration_app" ON "runtime_configuration_versions"
  TO starguidance_app USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "runtime_configuration_system" ON "runtime_configuration_versions"
  TO current_user USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON TABLE "runtime_configuration_versions" FROM PUBLIC, authenticated;--> statement-breakpoint
DO $anon_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE runtime_configuration_versions FROM anon';
  END IF;
END
$anon_guard$;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "runtime_configuration_versions" TO starguidance_app;
GRANT UPDATE (status, approved_by, approved_at, published_at)
  ON TABLE "runtime_configuration_versions" TO starguidance_app;
