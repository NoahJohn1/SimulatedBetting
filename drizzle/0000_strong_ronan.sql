CREATE TYPE "public"."auth_provider" AS ENUM('GOOGLE', 'APPLE');--> statement-breakpoint
CREATE TYPE "public"."season_status" AS ENUM('UPCOMING', 'ACTIVE', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('USER', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('PENDING', 'APPROVED', 'DISABLED');--> statement-breakpoint
CREATE TABLE "season_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"season_id" uuid NOT NULL,
	"balance_cents" bigint NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"starting_bankroll_cents" bigint NOT NULL,
	"weekly_allowance_cents" bigint NOT NULL,
	"allowance_weekday" smallint NOT NULL,
	"status" "season_status" DEFAULT 'UPCOMING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "auth_provider" NOT NULL,
	"provider_account_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'USER' NOT NULL,
	"status" "user_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "season_memberships" ADD CONSTRAINT "season_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_memberships" ADD CONSTRAINT "season_memberships_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "season_memberships_user_season_idx" ON "season_memberships" USING btree ("user_id","season_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seasons_one_active_idx" ON "seasons" USING btree ("status") WHERE "seasons"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "users_provider_account_idx" ON "users" USING btree ("provider","provider_account_id");