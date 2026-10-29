CREATE TYPE "public"."alert_severity" AS ENUM('CRITICO', 'ATENCAO', 'INFO', 'OPORTUNIDADE');--> statement-breakpoint
CREATE TYPE "public"."alert_status" AS ENUM('ABERTO', 'RESOLVIDO', 'IGNORADO');--> statement-breakpoint
CREATE TYPE "public"."alert_type" AS ENUM('ORCAMENTO', 'DUPLICIDADE', 'PRECO', 'DADOS', 'DESTINATARIO', 'OBRA_NAO_IDENTIFICADA', 'VENCIMENTO', 'ECONOMIA');--> statement-breakpoint
CREATE TYPE "public"."cost_category" AS ENUM('MATERIAIS', 'MAO_DE_OBRA', 'TERCEIRIZADOS', 'EQUIPAMENTOS', 'SERVICOS', 'OUTROS');--> statement-breakpoint
CREATE TYPE "public"."document_source" AS ENUM('UPLOAD', 'EMAIL', 'API', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('RECEBIDO', 'EM_REVISAO', 'APROVADO', 'REJEITADO', 'CANCELADO');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('NFE', 'NFSE', 'RECIBO', 'OUTRO');--> statement-breakpoint
CREATE TYPE "public"."payable_status" AS ENUM('ABERTO', 'PARCIAL', 'PAGO', 'CANCELADO');--> statement-breakpoint
CREATE TYPE "public"."project_status" AS ENUM('ATIVA', 'PAUSADA', 'CONCLUIDA');--> statement-breakpoint
CREATE TYPE "public"."supplier_status" AS ENUM('HOMOLOGADO', 'PENDENTE', 'BLOQUEADO');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('ADMIN', 'FINANCEIRO', 'GESTOR_OBRA');--> statement-breakpoint
CREATE TABLE "alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"type" "alert_type" NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"status" "alert_status" DEFAULT 'ABERTO' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"fingerprint" text NOT NULL,
	"project_id" uuid,
	"document_id" uuid,
	"supplier_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"category" "cost_category" NOT NULL,
	"amount" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"user_id" uuid,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"cnpj" text NOT NULL,
	"api_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_cnpj_unique" UNIQUE("cnpj"),
	CONSTRAINT "companies_api_key_unique" UNIQUE("api_key")
);
--> statement-breakpoint
CREATE TABLE "document_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"code" text,
	"description" text NOT NULL,
	"ncm" text,
	"cfop" text,
	"unit" text,
	"quantity" numeric(16, 4) NOT NULL,
	"unit_price" numeric(16, 4) NOT NULL,
	"total" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fiscal_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"supplier_id" uuid,
	"type" "document_type" DEFAULT 'NFE' NOT NULL,
	"source" "document_source" DEFAULT 'UPLOAD' NOT NULL,
	"status" "document_status" DEFAULT 'RECEBIDO' NOT NULL,
	"access_key" text,
	"number" text,
	"series" text,
	"issue_date" timestamp with time zone,
	"total_amount" bigint,
	"recipient_cnpj" text,
	"description" text,
	"extra_info" text,
	"category" "cost_category",
	"file_name" text,
	"file_path" text,
	"raw" jsonb,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggested_project_id" uuid,
	"suggestion_reason" text,
	"review_notes" text,
	"created_by_id" uuid,
	"approved_by_id" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payables" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"supplier_id" uuid,
	"installment" text NOT NULL,
	"due_date" timestamp with time zone NOT NULL,
	"amount" bigint NOT NULL,
	"paid_amount" bigint DEFAULT 0 NOT NULL,
	"status" "payable_status" DEFAULT 'ABERTO' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payable_id" uuid NOT NULL,
	"amount" bigint NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"method" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"category" "cost_category" NOT NULL,
	"amount" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"status" "project_status" DEFAULT 'ATIVA' NOT NULL,
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"budget_total" bigint NOT NULL,
	"image_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"cnpj" text NOT NULL,
	"name" text NOT NULL,
	"trade_name" text,
	"default_category" "cost_category",
	"status" "supplier_status" DEFAULT 'PENDENTE' NOT NULL,
	"email" text,
	"phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "user_role" DEFAULT 'FINANCEIRO' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_document_id_fiscal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_document_id_fiscal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_items" ADD CONSTRAINT "document_items_document_id_fiscal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD CONSTRAINT "fiscal_documents_suggested_project_id_projects_id_fk" FOREIGN KEY ("suggested_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_document_id_fiscal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payables" ADD CONSTRAINT "payables_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payable_id_payables_id_fk" FOREIGN KEY ("payable_id") REFERENCES "public"."payables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budgets" ADD CONSTRAINT "project_budgets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "alerts_company_fingerprint_uq" ON "alerts" USING btree ("company_id","fingerprint");--> statement-breakpoint
CREATE INDEX "alerts_company_status_idx" ON "alerts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "allocations_project_idx" ON "allocations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "allocations_doc_idx" ON "allocations" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "audit_company_entity_idx" ON "audit_logs" USING btree ("company_id","entity","entity_id");--> statement-breakpoint
CREATE INDEX "document_items_doc_idx" ON "document_items" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_company_key_uq" ON "fiscal_documents" USING btree ("company_id","access_key");--> statement-breakpoint
CREATE INDEX "documents_company_status_idx" ON "fiscal_documents" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "documents_supplier_number_idx" ON "fiscal_documents" USING btree ("company_id","supplier_id","number");--> statement-breakpoint
CREATE INDEX "payables_company_status_due_idx" ON "payables" USING btree ("company_id","status","due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "project_budgets_uq" ON "project_budgets" USING btree ("project_id","category");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_company_code_uq" ON "projects" USING btree ("company_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_company_cnpj_uq" ON "suppliers" USING btree ("company_id","cnpj");--> statement-breakpoint
CREATE INDEX "users_company_idx" ON "users" USING btree ("company_id");