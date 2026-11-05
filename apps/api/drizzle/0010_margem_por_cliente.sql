CREATE TYPE "public"."company_plan" AS ENUM('PILOTO', 'ESSENCIAL', 'PROFISSIONAL', 'AVANCADO', 'CORTESIA');--> statement-breakpoint
CREATE TABLE "company_month_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"month" text NOT NULL,
	"support_minutes" integer DEFAULT 0 NOT NULL,
	"ai_cost" bigint DEFAULT 0 NOT NULL,
	"other_cost" bigint DEFAULT 0 NOT NULL,
	"revenue_adjust" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "plan" "company_plan";--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "monthly_fee" bigint;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "setup_fee" bigint;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "billing_since" text;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD COLUMN "file_size" bigint;--> statement-breakpoint
ALTER TABLE "site_photos" ADD COLUMN "file_size" bigint;--> statement-breakpoint
ALTER TABLE "company_month_costs" ADD CONSTRAINT "company_month_costs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_month_costs_uq" ON "company_month_costs" USING btree ("company_id","month");