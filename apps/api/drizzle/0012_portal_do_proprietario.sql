CREATE TYPE "public"."contract_type" AS ENUM('EMPREITADA', 'ADMINISTRACAO');--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'PROPRIETARIO';--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "default_admin_fee_bps" integer DEFAULT 1500 NOT NULL;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "default_measurement_day" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "contract_type" "contract_type" DEFAULT 'EMPREITADA' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "admin_fee_bps" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "measurement_day" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_pays_suppliers" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_name" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "owner_email" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "owner_seen_at" timestamp with time zone;