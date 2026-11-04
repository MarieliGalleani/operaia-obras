CREATE TYPE "public"."purchase_order_status" AS ENUM('RASCUNHO', 'APROVADO', 'PARCIAL', 'ATENDIDO', 'CANCELADO');--> statement-breakpoint
ALTER TYPE "public"."alert_type" ADD VALUE 'PEDIDO';--> statement-breakpoint
CREATE TABLE "purchase_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"description" text NOT NULL,
	"unit" text,
	"quantity" numeric(16, 4) NOT NULL,
	"unit_price" numeric(16, 4) NOT NULL,
	"total" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"project_id" uuid NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" "purchase_order_status" DEFAULT 'RASCUNHO' NOT NULL,
	"category" "cost_category" DEFAULT 'MATERIAIS' NOT NULL,
	"expected_date" timestamp with time zone,
	"payment_terms" text,
	"notes" text,
	"total" bigint DEFAULT 0 NOT NULL,
	"created_by_id" uuid,
	"created_by_name" text,
	"approved_by_id" uuid,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD COLUMN "purchase_order_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_order_items" ADD CONSTRAINT "purchase_order_items_order_id_purchase_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_items_order_idx" ON "purchase_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchase_orders_company_number_uq" ON "purchase_orders" USING btree ("company_id","number");--> statement-breakpoint
CREATE INDEX "purchase_orders_company_status_idx" ON "purchase_orders" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("company_id","supplier_id");--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_purchase_order_id_purchase_orders_id_fk" FOREIGN KEY ("purchase_order_id") REFERENCES "public"."purchase_orders"("id") ON DELETE set null ON UPDATE no action;