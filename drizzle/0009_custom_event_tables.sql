CREATE TYPE "public"."custom_event_status" AS ENUM('OPEN', 'RESOLVED', 'VOIDED');--> statement-breakpoint
CREATE TABLE "custom_event_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "custom_events" (
	"event_id" uuid PRIMARY KEY NOT NULL,
	"season_id" uuid NOT NULL,
	"creator_membership_id" uuid NOT NULL,
	"description" text,
	"resolves_by" timestamp with time zone NOT NULL,
	"status" "custom_event_status" DEFAULT 'OPEN' NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolved_by_user_id" uuid,
	"resolution_note" text,
	"resolution_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "markets_event_type_idx";--> statement-breakpoint
DROP INDEX "selections_market_side_idx";--> statement-breakpoint
ALTER TABLE "markets" ALTER COLUMN "source_book" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "selections" ALTER COLUMN "side" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "markets" ADD COLUMN "winning_selection_id" uuid;--> statement-breakpoint
ALTER TABLE "selections" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "selections" ADD COLUMN "sort_order" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "custom_event_disputes" ADD CONSTRAINT "custom_event_disputes_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_event_disputes" ADD CONSTRAINT "custom_event_disputes_membership_id_season_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."season_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_events" ADD CONSTRAINT "custom_events_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_events" ADD CONSTRAINT "custom_events_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_events" ADD CONSTRAINT "custom_events_creator_membership_id_season_memberships_id_fk" FOREIGN KEY ("creator_membership_id") REFERENCES "public"."season_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_events" ADD CONSTRAINT "custom_events_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_event_disputes_unique_idx" ON "custom_event_disputes" USING btree ("event_id","membership_id");--> statement-breakpoint
CREATE INDEX "custom_event_disputes_open_idx" ON "custom_event_disputes" USING btree ("event_id") WHERE "custom_event_disputes"."resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX "custom_events_season_status_idx" ON "custom_events" USING btree ("season_id","status");--> statement-breakpoint
CREATE INDEX "custom_events_overdue_idx" ON "custom_events" USING btree ("resolves_by") WHERE "custom_events"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "custom_events_creator_idx" ON "custom_events" USING btree ("creator_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "selections_market_label_idx" ON "selections" USING btree ("market_id","label") WHERE "selections"."label" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "markets_event_type_idx" ON "markets" USING btree ("event_id","type") WHERE "markets"."type" <> 'CUSTOM_OUTCOME';--> statement-breakpoint
CREATE UNIQUE INDEX "selections_market_side_idx" ON "selections" USING btree ("market_id","side") WHERE "selections"."side" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "markets" ADD CONSTRAINT "markets_winning_selection_id_selections_id_fk"
  FOREIGN KEY ("winning_selection_id") REFERENCES "public"."selections"("id")
  ON DELETE no action ON UPDATE no action;
