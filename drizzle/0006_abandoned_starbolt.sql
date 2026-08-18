CREATE TYPE "public"."event_kind" AS ENUM('GAME', 'CUSTOM');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "event_kind" NOT NULL,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "events_kind_starts_at_idx" ON "events" USING btree ("kind","starts_at");--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "event_id" uuid;--> statement-breakpoint
UPDATE "games" SET "event_id" = gen_random_uuid() WHERE "event_id" IS NULL;--> statement-breakpoint
INSERT INTO "events" ("id", "kind", "title", "starts_at", "created_at")
SELECT g."event_id",
       'GAME',
       away."abbreviation" || ' @ ' || home."abbreviation",
       g."starts_at",
       g."created_at"
FROM "games" g
JOIN "teams" home ON home."id" = g."home_team_id"
JOIN "teams" away ON away."id" = g."away_team_id";--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "event_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_event_id_events_id_fk"
  FOREIGN KEY ("event_id") REFERENCES "public"."events"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "games_event_idx" ON "games" USING btree ("event_id");--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "event_id" uuid;--> statement-breakpoint
UPDATE "markets" m SET "event_id" = g."event_id" FROM "games" g WHERE g."id" = m."game_id";--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_event_id_events_id_fk"
  FOREIGN KEY ("event_id") REFERENCES "public"."events"("id")
  ON DELETE no action ON UPDATE no action;
