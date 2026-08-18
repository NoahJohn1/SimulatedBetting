ALTER TABLE "markets" DROP CONSTRAINT "markets_game_id_games_id_fk";
--> statement-breakpoint
DROP INDEX "markets_game_type_idx";--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "event_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "markets_event_type_idx" ON "markets" USING btree ("event_id","type");--> statement-breakpoint
ALTER TABLE "markets" DROP COLUMN "game_id";