CREATE TYPE "public"."currency" AS ENUM('CASH', 'CREDITS');--> statement-breakpoint
ALTER TABLE "season_memberships" ADD COLUMN "credits_balance_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "starting_credits_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "seasons" ADD COLUMN "weekly_credit_allowance_cents" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "bets" ADD COLUMN "currency" "currency" DEFAULT 'CASH' NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "currency" "currency" DEFAULT 'CASH' NOT NULL;--> statement-breakpoint
CREATE INDEX "ledger_entries_membership_currency_idx" ON "ledger_entries" USING btree ("membership_id","currency");