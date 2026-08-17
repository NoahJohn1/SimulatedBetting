ALTER TABLE "users" ALTER COLUMN "provider" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."auth_provider";--> statement-breakpoint
CREATE TYPE "public"."auth_provider" AS ENUM('GOOGLE');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "provider" SET DATA TYPE "public"."auth_provider" USING "provider"::"public"."auth_provider";