CREATE TYPE "public"."material_request_status" AS ENUM('ABERTA', 'EM_COMPRA', 'RECUSADA');--> statement-breakpoint
CREATE TYPE "public"."occurrence_severity" AS ENUM('BAIXA', 'MEDIA', 'ALTA');--> statement-breakpoint
CREATE TYPE "public"."occurrence_status" AS ENUM('ABERTA', 'RESOLVIDA');--> statement-breakpoint
CREATE TYPE "public"."occurrence_type" AS ENUM('FALTA_MATERIAL', 'ATRASO', 'SEGURANCA', 'QUALIDADE', 'CLIMA', 'ENTREGA', 'OUTRO');--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'OCORRENCIA';--> statement-breakpoint
ALTER TYPE "public"."user_role" ADD VALUE 'MESTRE';--> statement-breakpoint
CREATE TABLE "delivery_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"items" jsonb NOT NULL,
	"problem" boolean DEFAULT false NOT NULL,
	"notes" text,
	"received_by_id" uuid,
	"received_by_name" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "material_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"status" "material_request_status" DEFAULT 'ABERTA' NOT NULL,
	"items" jsonb NOT NULL,
	"needed_by" timestamp with time zone,
	"urgent" boolean DEFAULT false NOT NULL,
	"notes" text,
	"order_id" uuid,
	"decline_reason" text,
	"created_by_id" uuid,
	"created_by_name" text,
	"handled_by_name" text,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "occurrences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "occurrence_type" NOT NULL,
	"severity" "occurrence_severity" DEFAULT 'MEDIA' NOT NULL,
	"status" "occurrence_status" DEFAULT 'ABERTA' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"receipt_id" uuid,
	"created_by_id" uuid,
	"created_by_name" text,
	"resolution" text,
	"resolved_by_name" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone,
	"updated_by_name" text
);
--> statement-breakpoint
CREATE TABLE "site_photos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"url" text NOT NULL,
	"caption" text,
	"occurrence_id" uuid,
	"receipt_id" uuid,
	"stage_update_id" uuid,
	"user_id" uuid,
	"user_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stage_updates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stage_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"from_progress" integer NOT NULL,
	"progress" integer NOT NULL,
	"note" text,
	"user_id" uuid,
	"user_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "material_requests" ADD CONSTRAINT "material_requests_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_receipt_id_delivery_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."delivery_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_stages" ADD CONSTRAINT "project_stages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_photos" ADD CONSTRAINT "site_photos_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_photos" ADD CONSTRAINT "site_photos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_photos" ADD CONSTRAINT "site_photos_occurrence_id_occurrences_id_fk" FOREIGN KEY ("occurrence_id") REFERENCES "public"."occurrences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_photos" ADD CONSTRAINT "site_photos_receipt_id_delivery_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."delivery_receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_photos" ADD CONSTRAINT "site_photos_stage_update_id_stage_updates_id_fk" FOREIGN KEY ("stage_update_id") REFERENCES "public"."stage_updates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_updates" ADD CONSTRAINT "stage_updates_stage_id_project_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."project_stages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stage_updates" ADD CONSTRAINT "stage_updates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_receipts_order_idx" ON "delivery_receipts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "delivery_receipts_project_idx" ON "delivery_receipts" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "material_requests_company_status_idx" ON "material_requests" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "material_requests_project_idx" ON "material_requests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "occurrences_project_idx" ON "occurrences" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "occurrences_company_status_idx" ON "occurrences" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "project_stages_project_idx" ON "project_stages" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "site_photos_project_idx" ON "site_photos" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "stage_updates_project_idx" ON "stage_updates" USING btree ("project_id");