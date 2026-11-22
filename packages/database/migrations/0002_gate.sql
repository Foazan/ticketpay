-- QR tokens live for about a minute, so any existing rows are already expired and safe to drop.
DELETE FROM "ticket_qr_tokens";--> statement-breakpoint
ALTER TABLE "ticket_qr_tokens" ADD COLUMN "owner_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ticket_redemptions" ADD COLUMN "qr_token_id" text;--> statement-breakpoint
ALTER TABLE "ticket_redemptions" ADD COLUMN "chain_error" text;--> statement-breakpoint
ALTER TABLE "ticket_redemptions" ADD COLUMN "chain_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ticket_qr_tokens" ADD CONSTRAINT "ticket_qr_tokens_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_redemptions" ADD CONSTRAINT "ticket_redemptions_qr_token_id_ticket_qr_tokens_id_fk" FOREIGN KEY ("qr_token_id") REFERENCES "public"."ticket_qr_tokens"("id") ON DELETE no action ON UPDATE no action;