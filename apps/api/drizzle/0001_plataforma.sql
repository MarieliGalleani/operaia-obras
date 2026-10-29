CREATE TYPE "public"."company_status" AS ENUM('ATIVA', 'SUSPENSA');--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "status" "company_status" DEFAULT 'ATIVA' NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_platform_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_at" timestamp with time zone;