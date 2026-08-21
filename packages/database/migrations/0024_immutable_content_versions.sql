ALTER TABLE "card_meanings" DROP CONSTRAINT "card_meanings_card_id_cards_id_fk";
--> statement-breakpoint
ALTER TABLE "reading_sessions" DROP CONSTRAINT "reading_sessions_spread_id_spreads_id_fk";
--> statement-breakpoint
ALTER TABLE "spread_positions" DROP CONSTRAINT "spread_positions_spread_id_spreads_id_fk";
--> statement-breakpoint
DROP INDEX "card_meaning_content_unique";--> statement-breakpoint
DROP INDEX "spread_position_unique";--> statement-breakpoint
ALTER TABLE "card_meanings" ADD COLUMN "deck_version" text;--> statement-breakpoint
UPDATE "card_meanings" AS meaning
SET "deck_version" = card."deck_version"
FROM "cards" AS card
WHERE meaning."card_id" = card."id";--> statement-breakpoint
ALTER TABLE "card_meanings" ALTER COLUMN "deck_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "spread_positions" ADD COLUMN "spread_version" text;--> statement-breakpoint
UPDATE "spread_positions" AS position
SET "spread_version" = spread."version"
FROM "spreads" AS spread
WHERE position."spread_id" = spread."id";--> statement-breakpoint
ALTER TABLE "spread_positions" ALTER COLUMN "spread_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cards" DROP CONSTRAINT "cards_pkey";--> statement-breakpoint
ALTER TABLE "spreads" DROP CONSTRAINT "spreads_pkey";--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_id_deck_version_pk" PRIMARY KEY("id","deck_version");--> statement-breakpoint
ALTER TABLE "spreads" ADD CONSTRAINT "spreads_id_version_pk" PRIMARY KEY("id","version");--> statement-breakpoint
ALTER TABLE "card_meanings" ADD CONSTRAINT "card_meanings_card_deck_fk" FOREIGN KEY ("card_id","deck_version") REFERENCES "public"."cards"("id","deck_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_sessions" ADD CONSTRAINT "reading_sessions_spread_version_fk" FOREIGN KEY ("spread_id","spread_version") REFERENCES "public"."spreads"("id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "spread_positions" ADD CONSTRAINT "spread_positions_spread_version_fk" FOREIGN KEY ("spread_id","spread_version") REFERENCES "public"."spreads"("id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "card_meaning_content_unique" ON "card_meanings" USING btree ("card_id","deck_version","content_version");--> statement-breakpoint
CREATE UNIQUE INDEX "spread_position_unique" ON "spread_positions" USING btree ("spread_id","spread_version","position_id");
