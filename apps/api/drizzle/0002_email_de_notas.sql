CREATE TABLE "mail_inboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"host" text NOT NULL,
	"port" integer DEFAULT 993 NOT NULL,
	"secure" boolean DEFAULT true NOT NULL,
	"username" text NOT NULL,
	"password_enc" text NOT NULL,
	"mailbox" text DEFAULT 'INBOX' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_check_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_error" text,
	"last_error_at" timestamp with time zone,
	"messages_processed" integer DEFAULT 0 NOT NULL,
	"documents_received" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_inboxes_company_id_unique" UNIQUE("company_id")
);
--> statement-breakpoint
ALTER TABLE "mail_inboxes" ADD CONSTRAINT "mail_inboxes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;