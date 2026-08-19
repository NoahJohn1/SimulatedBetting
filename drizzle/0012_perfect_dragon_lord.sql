ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'P2P_ESCROW';--> statement-breakpoint
ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'P2P_WON';--> statement-breakpoint
ALTER TYPE "public"."ledger_entry_type" ADD VALUE 'P2P_REFUND';--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD COLUMN "p2p_wager_id" uuid;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_p2p_wager_id_p2p_wagers_id_fk" FOREIGN KEY ("p2p_wager_id") REFERENCES "public"."p2p_wagers"("id") ON DELETE no action ON UPDATE no action;