CREATE TYPE "public"."notification_channel" AS ENUM('IMMEDIATE', 'DIGEST');--> statement-breakpoint
CREATE TYPE "public"."notification_outcome" AS ENUM('SENT', 'SUPPRESSED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."notification_type" AS ENUM('WAGER_OFFERED', 'OFFER_EXPIRING', 'DISPUTE_NEEDS_RULING', 'ACCOUNT_APPROVED', 'BETS_SETTLED', 'ALLOWANCE_PAID');--> statement-breakpoint
ALTER TYPE "public"."job_name" ADD VALUE 'NOTIFY';--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"muted_types" "notification_type"[] DEFAULT '{}'::notification_type[] NOT NULL,
	"emails_enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"dedupe_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"outcome" "notification_outcome",
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_dedupe_key_idx" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "notifications_pending_idx" ON "notifications" USING btree ("channel","queued_at") WHERE "notifications"."sent_at" is null;