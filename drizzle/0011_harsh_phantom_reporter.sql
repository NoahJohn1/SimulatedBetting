CREATE TYPE "public"."p2p_verdict" AS ENUM('OFFERER', 'ACCEPTOR', 'VOID');--> statement-breakpoint
CREATE TYPE "public"."p2p_wager_kind" AS ENUM('MARKET', 'FREEFORM');--> statement-breakpoint
CREATE TYPE "public"."p2p_wager_status" AS ENUM('OFFERED', 'ACCEPTED', 'SETTLED', 'VOIDED', 'CANCELED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "p2p_wagers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season_id" uuid NOT NULL,
	"kind" "p2p_wager_kind" NOT NULL,
	"status" "p2p_wager_status" DEFAULT 'OFFERED' NOT NULL,
	"offerer_membership_id" uuid NOT NULL,
	"acceptor_membership_id" uuid,
	"opponent_membership_id" uuid,
	"offerer_stake_cents" bigint NOT NULL,
	"acceptor_stake_cents" bigint NOT NULL,
	"selection_id" uuid,
	"line_at_offer" numeric(5, 2),
	"description" text,
	"expires_at" timestamp with time zone NOT NULL,
	"resolves_by" timestamp with time zone NOT NULL,
	"offerer_claim" "p2p_verdict",
	"acceptor_claim" "p2p_verdict",
	"offerer_cancel_proposed" boolean DEFAULT false NOT NULL,
	"acceptor_cancel_proposed" boolean DEFAULT false NOT NULL,
	"verdict" "p2p_verdict",
	"settlement_attempts" integer DEFAULT 0 NOT NULL,
	"resolved_by_user_id" uuid,
	"resolution_note" text,
	"accepted_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "p2p_wagers_kind_shape" CHECK (("p2p_wagers"."kind" = 'MARKET' AND "p2p_wagers"."selection_id" IS NOT NULL AND "p2p_wagers"."description" IS NULL)
       OR ("p2p_wagers"."kind" = 'FREEFORM' AND "p2p_wagers"."selection_id" IS NULL AND "p2p_wagers"."description" IS NOT NULL)),
	CONSTRAINT "p2p_wagers_positive_stakes" CHECK ("p2p_wagers"."offerer_stake_cents" > 0 AND "p2p_wagers"."acceptor_stake_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "p2p_wagers" ADD CONSTRAINT "p2p_wagers_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "p2p_wagers" ADD CONSTRAINT "p2p_wagers_offerer_membership_id_season_memberships_id_fk" FOREIGN KEY ("offerer_membership_id") REFERENCES "public"."season_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "p2p_wagers" ADD CONSTRAINT "p2p_wagers_acceptor_membership_id_season_memberships_id_fk" FOREIGN KEY ("acceptor_membership_id") REFERENCES "public"."season_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "p2p_wagers" ADD CONSTRAINT "p2p_wagers_opponent_membership_id_season_memberships_id_fk" FOREIGN KEY ("opponent_membership_id") REFERENCES "public"."season_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "p2p_wagers" ADD CONSTRAINT "p2p_wagers_selection_id_selections_id_fk" FOREIGN KEY ("selection_id") REFERENCES "public"."selections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "p2p_wagers" ADD CONSTRAINT "p2p_wagers_resolved_by_user_id_users_id_fk" FOREIGN KEY ("resolved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "p2p_wagers_season_status_idx" ON "p2p_wagers" USING btree ("season_id","status");--> statement-breakpoint
CREATE INDEX "p2p_wagers_offerer_idx" ON "p2p_wagers" USING btree ("offerer_membership_id");--> statement-breakpoint
CREATE INDEX "p2p_wagers_acceptor_idx" ON "p2p_wagers" USING btree ("acceptor_membership_id");--> statement-breakpoint
CREATE INDEX "p2p_wagers_selection_idx" ON "p2p_wagers" USING btree ("selection_id");--> statement-breakpoint
CREATE INDEX "p2p_wagers_open_idx" ON "p2p_wagers" USING btree ("expires_at") WHERE "p2p_wagers"."status" = 'OFFERED';--> statement-breakpoint
CREATE INDEX "p2p_wagers_live_idx" ON "p2p_wagers" USING btree ("resolves_by") WHERE "p2p_wagers"."status" = 'ACCEPTED';