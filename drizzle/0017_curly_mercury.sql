CREATE TYPE "public"."accent" AS ENUM('GREEN', 'BLUE', 'INDIGO', 'VIOLET', 'TEAL', 'ORANGE');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "accent" "accent" DEFAULT 'GREEN' NOT NULL;