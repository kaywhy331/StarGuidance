ALTER TABLE "orders" ADD COLUMN "profile_snapshot_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD COLUMN "reading_lens" jsonb;--> statement-breakpoint

UPDATE "orders" o
SET "profile_snapshot_id" = e."profile_snapshot_id"
FROM "entitlements" e
WHERE e."order_id" = o."id" AND o."profile_snapshot_id" IS NULL;--> statement-breakpoint
UPDATE "orders"
SET "idempotency_key" = 'legacy:' || "id"::text
WHERE "idempotency_key" IS NULL;--> statement-breakpoint

DO $migration_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM "orders" WHERE "profile_snapshot_id" IS NULL) THEN
    RAISE EXCEPTION 'Cannot migrate legacy orders without a durable profile snapshot reference';
  END IF;
  IF EXISTS (SELECT 1 FROM "reading_sessions" WHERE "reading_lens" IS NULL) THEN
    RAISE EXCEPTION 'Cannot invent a reading lens for a legacy reading session';
  END IF;
END
$migration_guard$;--> statement-breakpoint

ALTER TABLE "orders" ALTER COLUMN "profile_snapshot_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "reading_sessions" ALTER COLUMN "reading_lens" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_profile_snapshot_id_profile_snapshots_id_fk" FOREIGN KEY ("profile_snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "birth_profiles" ADD CONSTRAINT "birth_profiles_active_snapshot_id_profile_snapshots_id_fk" FOREIGN KEY ("active_snapshot_id") REFERENCES "public"."profile_snapshots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_user_idempotency_unique" ON "orders" USING btree ("user_id","idempotency_key");--> statement-breakpoint

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END
$roles$;--> statement-breakpoint

DO $auth_link$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_auth_user_id_fk
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

    CREATE OR REPLACE FUNCTION public.sync_authenticated_user()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = ''
    AS $function$
    BEGIN
      INSERT INTO public.users (id, email)
      VALUES (new.id, coalesce(new.email, new.id::text || '@private.invalid'))
      ON CONFLICT (id) DO UPDATE SET email = excluded.email;
      RETURN new;
    END
    $function$;

    EXECUTE 'CREATE TRIGGER sync_authenticated_user_after_insert
      AFTER INSERT OR UPDATE OF email ON auth.users
      FOR EACH ROW EXECUTE FUNCTION public.sync_authenticated_user()';
  END IF;
END
$auth_link$;--> statement-breakpoint

DO $force_rls$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'users', 'user_settings', 'consents', 'birth_profiles', 'profile_snapshots',
    'profile_components', 'profile_traits', 'reading_sessions', 'reading_draws',
    'reading_outputs', 'follow_up_questions', 'reading_feedback', 'orders',
    'entitlements', 'reports', 'report_sections', 'audit_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', table_name);
  END LOOP;
END
$force_rls$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO authenticated;--> statement-breakpoint
GRANT SELECT ON TABLE decks, cards, card_meanings, spreads, spread_positions, products,
  prompt_versions, calculation_versions, content_versions TO authenticated;--> statement-breakpoint
REVOKE ALL ON TABLE payment_webhook_events FROM PUBLIC, authenticated;
