CREATE TABLE "product_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_name" text NOT NULL,
	"properties" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_events_idempotency_unique" ON "product_events" USING btree ("idempotency_key");--> statement-breakpoint

/*
 * Product events are aggregate-first operational evidence, not user rows:
 * there is deliberately no subject, email, IP, cookie, URL, question, birth
 * value, card context, or report prose. Even so, only the trusted server role
 * may insert/read them. Browser JWT roles and PUBLIC receive no table access.
 */
ALTER TABLE "product_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_events" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "product_events_app_only" ON "product_events" FOR ALL USING (true) WITH CHECK (true);--> statement-breakpoint
REVOKE ALL ON TABLE "product_events" FROM PUBLIC, authenticated;--> statement-breakpoint
DO $anon_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON TABLE product_events FROM anon';
  END IF;
END
$anon_guard$;--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE "product_events" TO starguidance_app;
