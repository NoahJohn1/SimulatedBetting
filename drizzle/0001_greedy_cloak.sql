CREATE TYPE "public"."ledger_entry_type" AS ENUM('SEASON_STARTING_GRANT', 'WEEKLY_ALLOWANCE', 'BET_PLACED', 'BET_WON', 'BET_PUSHED', 'BET_VOIDED', 'ADMIN_CREDIT', 'ADMIN_DEBIT', 'SETTLEMENT_REVERSAL');--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"membership_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"balance_after_cents" bigint NOT NULL,
	"actor_user_id" uuid,
	"note" text,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_membership_id_season_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."season_memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_idx" ON "ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_entries_membership_idx" ON "ledger_entries" USING btree ("membership_id","created_at");