CREATE TYPE "public"."game_status" AS ENUM('SCHEDULED', 'IN_PROGRESS', 'FINAL', 'POSTPONED', 'CANCELED');--> statement-breakpoint
CREATE TYPE "public"."market_status" AS ENUM('OPEN', 'SUSPENDED', 'SETTLED');--> statement-breakpoint
CREATE TYPE "public"."market_type" AS ENUM('MONEYLINE', 'SPREAD', 'TOTAL');--> statement-breakpoint
CREATE TYPE "public"."selection_side" AS ENUM('HOME', 'AWAY', 'OVER', 'UNDER');--> statement-breakpoint
CREATE TYPE "public"."sport" AS ENUM('NFL', 'NCAAF');--> statement-breakpoint
CREATE TYPE "public"."bet_status" AS ENUM('PENDING', 'WON', 'LOST', 'PUSHED', 'VOIDED');--> statement-breakpoint
CREATE TYPE "public"."bet_type" AS ENUM('SINGLE', 'PARLAY');--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport" "sport" NOT NULL,
	"external_id" text NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"season_year" integer NOT NULL,
	"week" smallint,
	"status" "game_status" DEFAULT 'SCHEDULED' NOT NULL,
	"home_score" integer,
	"away_score" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "markets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"type" "market_type" NOT NULL,
	"source_book" text NOT NULL,
	"status" "market_status" DEFAULT 'OPEN' NOT NULL,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "odds_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"selection_id" uuid NOT NULL,
	"line" numeric(5, 2),
	"price_american" integer NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"market_id" uuid NOT NULL,
	"side" "selection_side" NOT NULL,
	"line" numeric(5, 2),
	"price_american" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sport" "sport" NOT NULL,
	"external_id" text NOT NULL,
	"name" text NOT NULL,
	"abbreviation" text NOT NULL,
	"logo_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bet_legs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bet_id" uuid NOT NULL,
	"selection_id" uuid NOT NULL,
	"line_at_placement" numeric(5, 2),
	"price_at_placement" integer NOT NULL,
	"status" "bet_status" DEFAULT 'PENDING' NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"type" "bet_type" NOT NULL,
	"stake_cents" bigint NOT NULL,
	"potential_payout_cents" bigint NOT NULL,
	"combined_price_american" integer NOT NULL,
	"status" "bet_status" DEFAULT 'PENDING' NOT NULL,
	"settlement_attempts" integer DEFAULT 0 NOT NULL,
	"client_request_id" uuid NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "bet_id" uuid;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "odds_snapshots" ADD CONSTRAINT "odds_snapshots_selection_id_selections_id_fk" FOREIGN KEY ("selection_id") REFERENCES "public"."selections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selections" ADD CONSTRAINT "selections_market_id_markets_id_fk" FOREIGN KEY ("market_id") REFERENCES "public"."markets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bet_legs" ADD CONSTRAINT "bet_legs_selection_id_selections_id_fk" FOREIGN KEY ("selection_id") REFERENCES "public"."selections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bets" ADD CONSTRAINT "bets_membership_id_season_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."season_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "games_sport_external_idx" ON "games" USING btree ("sport","external_id");--> statement-breakpoint
CREATE INDEX "games_status_starts_at_idx" ON "games" USING btree ("status","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "markets_game_type_idx" ON "markets" USING btree ("game_id","type");--> statement-breakpoint
CREATE INDEX "odds_snapshots_selection_idx" ON "odds_snapshots" USING btree ("selection_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "selections_market_side_idx" ON "selections" USING btree ("market_id","side");--> statement-breakpoint
CREATE UNIQUE INDEX "teams_sport_external_idx" ON "teams" USING btree ("sport","external_id");--> statement-breakpoint
CREATE INDEX "bet_legs_bet_idx" ON "bet_legs" USING btree ("bet_id");--> statement-breakpoint
CREATE INDEX "bet_legs_selection_idx" ON "bet_legs" USING btree ("selection_id");--> statement-breakpoint
CREATE INDEX "bet_legs_pending_idx" ON "bet_legs" USING btree ("status") WHERE "bet_legs"."status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "bets_client_request_idx" ON "bets" USING btree ("client_request_id");--> statement-breakpoint
CREATE INDEX "bets_membership_status_idx" ON "bets" USING btree ("membership_id","status");--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;