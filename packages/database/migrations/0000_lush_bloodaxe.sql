CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "birth_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"encrypted_payload" text NOT NULL,
	"active_snapshot_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "calculation_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"system" text NOT NULL,
	"version" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "card_meanings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" text NOT NULL,
	"content_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" text PRIMARY KEY NOT NULL,
	"deck_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"policy" text NOT NULL,
	"policy_version" text NOT NULL,
	"accepted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "content_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_type" text NOT NULL,
	"version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decks_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"profile_snapshot_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "entitlements_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "follow_up_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"encrypted_question" text NOT NULL,
	"output" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"product_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_session_id" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "orders_provider_session_id_unique" UNIQUE("provider_session_id")
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_webhook_events_provider_event_id_unique" UNIQUE("provider_event_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profile_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"system" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "profile_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"completeness" text NOT NULL,
	"derived_payload" jsonb NOT NULL,
	"calculation_versions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "profile_traits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"statement" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"version" text NOT NULL,
	"purpose" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_version_unique" UNIQUE("version")
);
--> statement-breakpoint
CREATE TABLE "reading_draws" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"deck_version" text NOT NULL,
	"shuffle_version" text NOT NULL,
	"assignments" jsonb NOT NULL,
	"locked_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "reading_draws_reading_id_unique" UNIQUE("reading_id")
);
--> statement-breakpoint
CREATE TABLE "reading_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"resonance" integer,
	"helpfulness" integer,
	"encrypted_comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "reading_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reading_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"prompt_version" text NOT NULL,
	"content_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "reading_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"profile_snapshot_id" uuid NOT NULL,
	"spread_id" text NOT NULL,
	"spread_version" text NOT NULL,
	"encrypted_question" text NOT NULL,
	"safety_classification" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "report_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"report_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"profile_snapshot_id" uuid NOT NULL,
	"status" text NOT NULL,
	"template_version" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "reports_entitlement_id_unique" UNIQUE("entitlement_id")
);
--> statement-breakpoint
CREATE TABLE "spread_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spread_id" text NOT NULL,
	"position_id" text NOT NULL,
	"display_order" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "spreads" (
	"id" text PRIMARY KEY NOT NULL,
	"version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"sound_enabled" boolean DEFAULT false NOT NULL,
	"reduced_motion" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "profile_snapshot_version_unique" ON "profile_snapshots" USING btree ("profile_id","version");
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users_self" ON "users" FOR ALL USING ("id" = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid) WITH CHECK ("id" = nullif(current_setting('request.jwt.claim.sub', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE "user_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "birth_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile_snapshots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile_components" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile_traits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reading_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reading_draws" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reading_outputs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "follow_up_questions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reading_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "entitlements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_sections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DO $policy$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'user_settings', 'consents', 'birth_profiles', 'profile_snapshots', 'profile_components',
    'profile_traits', 'reading_sessions', 'reading_draws', 'reading_outputs',
    'follow_up_questions', 'reading_feedback', 'orders', 'entitlements', 'reports',
    'report_sections', 'audit_events'
  ]
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (user_id = nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid) WITH CHECK (user_id = nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid)',
      table_name || '_owner', table_name
    );
  END LOOP;
END
$policy$;
