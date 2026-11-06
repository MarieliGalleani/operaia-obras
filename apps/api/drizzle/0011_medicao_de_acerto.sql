CREATE TYPE "public"."check_outcome" AS ENUM('ACERTOU', 'ERROU', 'SEM_SUGESTAO');--> statement-breakpoint
CREATE TABLE "suggestion_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"source" text NOT NULL,
	"field" text NOT NULL,
	"outcome" "check_outcome" NOT NULL,
	"suggested" text,
	"final" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fiscal_documents" ADD COLUMN "suggestion" jsonb;--> statement-breakpoint
ALTER TABLE "suggestion_checks" ADD CONSTRAINT "suggestion_checks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suggestion_checks" ADD CONSTRAINT "suggestion_checks_document_id_fiscal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."fiscal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "suggestion_checks_doc_field_uq" ON "suggestion_checks" USING btree ("document_id","field");--> statement-breakpoint
CREATE INDEX "suggestion_checks_company_idx" ON "suggestion_checks" USING btree ("company_id","created_at");