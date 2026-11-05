ALTER TABLE "payments" ADD COLUMN "reversed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reversed_by_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "reverse_reason" text;