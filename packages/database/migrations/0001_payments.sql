CREATE TYPE "public"."payment_method" AS ENUM('VA', 'QRIS', 'EWALLET');--> statement-breakpoint
ALTER TYPE "public"."webhook_event_outcome" ADD VALUE 'UNSUPPORTED' BEFORE 'REJECTED';--> statement-breakpoint
-- Defaults only backfill rows that already exist, then are dropped so new rows must set the value.
ALTER TABLE "payment_webhook_events" ADD COLUMN "source" text NOT NULL DEFAULT 'MIDTRANS';--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "method" "payment_method" NOT NULL DEFAULT 'VA';--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "method" DROP DEFAULT;
