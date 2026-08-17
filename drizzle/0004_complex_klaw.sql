CREATE TYPE "public"."feed_event_type" AS ENUM('BET_PLACED', 'BET_SETTLED', 'MEMBER_JOINED', 'ALLOWANCE_PAID', 'ADMIN_ADJUSTMENT', 'MILESTONE_LEAD_CHANGE', 'MILESTONE_BIG_WIN', 'MILESTONE_PARLAY_HIT');--> statement-breakpoint
CREATE TABLE "feed_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"deleted_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "feed_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"type" "feed_event_type" NOT NULL,
	"subject_membership_id" uuid,
	"bet_id" uuid,
	"ledger_entry_id" uuid,
	"payload" jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"muted_types" "feed_event_type"[] DEFAULT '{}'::feed_event_type[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_event_id_feed_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."feed_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_membership_id_season_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."season_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_comments" ADD CONSTRAINT "feed_comments_deleted_by_user_id_users_id_fk" FOREIGN KEY ("deleted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_subject_membership_id_season_memberships_id_fk" FOREIGN KEY ("subject_membership_id") REFERENCES "public"."season_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_bet_id_bets_id_fk" FOREIGN KEY ("bet_id") REFERENCES "public"."bets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_events" ADD CONSTRAINT "feed_events_ledger_entry_id_ledger_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_preferences" ADD CONSTRAINT "feed_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_event_id_feed_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."feed_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feed_reactions" ADD CONSTRAINT "feed_reactions_membership_id_season_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."season_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feed_comments_event_idx" ON "feed_comments" USING btree ("event_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_events_dedupe_key_idx" ON "feed_events" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "feed_events_season_idx" ON "feed_events" USING btree ("season_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feed_events_subject_idx" ON "feed_events" USING btree ("subject_membership_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "feed_events_bet_idx" ON "feed_events" USING btree ("bet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_reactions_unique_idx" ON "feed_reactions" USING btree ("event_id","membership_id","emoji");--> statement-breakpoint
CREATE INDEX "feed_reactions_event_idx" ON "feed_reactions" USING btree ("event_id");