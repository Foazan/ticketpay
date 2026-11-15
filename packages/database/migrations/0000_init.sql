CREATE TYPE "public"."chain_tx_status" AS ENUM('QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."chain_tx_type" AS ENUM('MINT', 'REDEEM', 'SET_SUPPLY', 'CANCEL');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('CREDIT', 'DEBIT');--> statement-breakpoint
CREATE TYPE "public"."ledger_entry_type" AS ENUM('GROSS_SALE', 'SERVICE_FEE', 'PROVIDER_FEE', 'MERCHANT_NET', 'REFUND', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."merchant_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."mint_status" AS ENUM('PENDING', 'SUBMITTED', 'MINTED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."payment_provider" AS ENUM('MOCK', 'MIDTRANS');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUND_PENDING', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."redemption_chain_status" AS ENUM('PENDING', 'CONFIRMED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."redemption_method" AS ENUM('QR', 'MANUAL_CODE');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('BUYER', 'ORGANIZER', 'GATE_STAFF', 'ADMIN');--> statement-breakpoint
CREATE TYPE "public"."ticket_status" AS ENUM('ACTIVE', 'REDEEMED', 'CANCELLED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('PENDING', 'DELIVERED', 'RETRYING', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."webhook_event_outcome" AS ENUM('APPLIED', 'DUPLICATE', 'IGNORED_STALE', 'REJECTED');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_id" text,
	"actor_role" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"metadata" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blockchain_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"type" "chain_tx_type" NOT NULL,
	"ticket_id" text,
	"event_id" text,
	"tx_hash" text,
	"status" "chain_tx_status" DEFAULT 'QUEUED' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"chain_id" integer NOT NULL,
	"block_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blockchain_transactions_txHash_unique" UNIQUE("tx_hash")
);
--> statement-breakpoint
CREATE TABLE "event_categories" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_categories_name_unique" UNIQUE("name"),
	CONSTRAINT "event_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"category_id" text NOT NULL,
	"on_chain_event_id" serial NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"description" text NOT NULL,
	"city" text NOT NULL,
	"venue" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"poster_path" text NOT NULL,
	"status" "event_status" DEFAULT 'DRAFT' NOT NULL,
	"is_featured" boolean DEFAULT false NOT NULL,
	"requires_id_check" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "events_onChainEventId_unique" UNIQUE("on_chain_event_id"),
	CONSTRAINT "events_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "gate_event_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"gate_staff_id" text NOT NULL,
	"event_id" text NOT NULL,
	"granted_by_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"type" "ledger_entry_type" NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount" integer NOT NULL,
	"description" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_dedupeKey_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "ledger_entries_amount_non_negative" CHECK ("ledger_entries"."amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "merchant_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"last_four" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_api_keys_keyPrefix_unique" UNIQUE("key_prefix")
);
--> statement-breakpoint
CREATE TABLE "merchant_webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'PENDING' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_status_code" integer,
	"last_error" text,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "merchant_webhook_deliveries_eventId_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "merchants" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"business_name" text NOT NULL,
	"organizer_type" text NOT NULL,
	"contact_person" text NOT NULL,
	"phone" text NOT NULL,
	"address" text NOT NULL,
	"description" text,
	"status" "merchant_status" DEFAULT 'PENDING' NOT NULL,
	"status_reason" text,
	"webhook_url" text,
	"webhook_secret_enc" text,
	"settlement_account_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "merchants_userId_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"tier_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" integer NOT NULL,
	CONSTRAINT "order_items_quantity_positive" CHECK ("order_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"order_number" text NOT NULL,
	"buyer_id" text NOT NULL,
	"event_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"status" "order_status" DEFAULT 'PENDING' NOT NULL,
	"subtotal" integer NOT NULL,
	"service_fee" integer NOT NULL,
	"fee_rate_bps" integer NOT NULL,
	"total" integer NOT NULL,
	"buyer_name" text NOT NULL,
	"buyer_email" text NOT NULL,
	"buyer_phone" text,
	"hold_expires_at" timestamp with time zone NOT NULL,
	"checkout_key" text NOT NULL,
	"is_seed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_orderNumber_unique" UNIQUE("order_number")
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"payment_id" text,
	"dedupe_key" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"provider_status" text,
	"outcome" "webhook_event_outcome" NOT NULL,
	"payload_redacted" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_webhook_events_dedupeKey_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"merchant_id" text NOT NULL,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"amount" integer NOT NULL,
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"provider" "payment_provider" NOT NULL,
	"provider_status" text,
	"provider_transaction_id" text,
	"payment_type" text,
	"snap_token" text,
	"redirect_url" text,
	"paid_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_orderId_unique" UNIQUE("order_id"),
	CONSTRAINT "payments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "platform_fee_settings" (
	"id" text PRIMARY KEY NOT NULL,
	"fee_rate_bps" integer NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"set_by_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_fee_settings_range" CHECK ("platform_fee_settings"."fee_rate_bps" >= 0 AND "platform_fee_settings"."fee_rate_bps" <= 10000)
);
--> statement-breakpoint
CREATE TABLE "reconciliation_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"merchant_id" text,
	"generated_by_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"counts_by_status" jsonb NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ticket_qr_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_qr_tokens_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "ticket_redemptions" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"gate_staff_id" text NOT NULL,
	"event_id" text NOT NULL,
	"method" "redemption_method" NOT NULL,
	"chain_status" "redemption_chain_status" DEFAULT 'PENDING' NOT NULL,
	"redeemed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_redemptions_ticketId_unique" UNIQUE("ticket_id")
);
--> statement-breakpoint
CREATE TABLE "ticket_tiers" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"name" text NOT NULL,
	"tier_code" integer NOT NULL,
	"price" integer NOT NULL,
	"quota" integer NOT NULL,
	"sold_count" integer DEFAULT 0 NOT NULL,
	"held_count" integer DEFAULT 0 NOT NULL,
	"sales_start_at" timestamp with time zone NOT NULL,
	"sales_end_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ticket_tiers_no_oversell" CHECK ("ticket_tiers"."sold_count" + "ticket_tiers"."held_count" <= "ticket_tiers"."quota"),
	CONSTRAINT "ticket_tiers_non_negative" CHECK ("ticket_tiers"."sold_count" >= 0 AND "ticket_tiers"."held_count" >= 0 AND "ticket_tiers"."quota" >= 0 AND "ticket_tiers"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"order_id" text NOT NULL,
	"order_item_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"event_id" text NOT NULL,
	"tier_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"seq" integer NOT NULL,
	"payment_ref_hash" text NOT NULL,
	"token_id" text,
	"status" "ticket_status" DEFAULT 'ACTIVE' NOT NULL,
	"mint_status" "mint_status" DEFAULT 'PENDING' NOT NULL,
	"validation_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tickets_paymentRefHash_unique" UNIQUE("payment_ref_hash"),
	CONSTRAINT "tickets_tokenId_unique" UNIQUE("token_id"),
	CONSTRAINT "tickets_validationCode_unique" UNIQUE("validation_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"phone" text,
	"role" "role" DEFAULT 'BUYER' NOT NULL,
	"custodial_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_custodialAddress_unique" UNIQUE("custodial_address")
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_category_id_event_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."event_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_event_permissions" ADD CONSTRAINT "gate_event_permissions_gate_staff_id_users_id_fk" FOREIGN KEY ("gate_staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_event_permissions" ADD CONSTRAINT "gate_event_permissions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_event_permissions" ADD CONSTRAINT "gate_event_permissions_granted_by_id_users_id_fk" FOREIGN KEY ("granted_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_api_keys" ADD CONSTRAINT "merchant_api_keys_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_webhook_deliveries" ADD CONSTRAINT "merchant_webhook_deliveries_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchant_webhook_deliveries" ADD CONSTRAINT "merchant_webhook_deliveries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merchants" ADD CONSTRAINT "merchants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tier_id_ticket_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."ticket_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_fee_settings" ADD CONSTRAINT "platform_fee_settings_set_by_id_users_id_fk" FOREIGN KEY ("set_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_merchant_id_merchants_id_fk" FOREIGN KEY ("merchant_id") REFERENCES "public"."merchants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_reports" ADD CONSTRAINT "reconciliation_reports_generated_by_id_users_id_fk" FOREIGN KEY ("generated_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_qr_tokens" ADD CONSTRAINT "ticket_qr_tokens_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_redemptions" ADD CONSTRAINT "ticket_redemptions_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_redemptions" ADD CONSTRAINT "ticket_redemptions_gate_staff_id_users_id_fk" FOREIGN KEY ("gate_staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_redemptions" ADD CONSTRAINT "ticket_redemptions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_tiers" ADD CONSTRAINT "ticket_tiers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_tier_id_ticket_tiers_id_fk" FOREIGN KEY ("tier_id") REFERENCES "public"."ticket_tiers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "blockchain_transactions_status_idx" ON "blockchain_transactions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "blockchain_transactions_ticket_idx" ON "blockchain_transactions" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "events_merchant_idx" ON "events" USING btree ("merchant_id");--> statement-breakpoint
CREATE INDEX "events_status_start_idx" ON "events" USING btree ("status","start_at");--> statement-breakpoint
CREATE INDEX "events_category_idx" ON "events" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "events_city_idx" ON "events" USING btree ("city");--> statement-breakpoint
CREATE UNIQUE INDEX "gate_event_permissions_staff_event_key" ON "gate_event_permissions" USING btree ("gate_staff_id","event_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_merchant_idx" ON "ledger_entries" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_payment_idx" ON "ledger_entries" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "merchant_api_keys_merchant_idx" ON "merchant_api_keys" USING btree ("merchant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "merchant_webhook_deliveries_payment_type_key" ON "merchant_webhook_deliveries" USING btree ("payment_id","event_type");--> statement-breakpoint
CREATE INDEX "merchant_webhook_deliveries_merchant_idx" ON "merchant_webhook_deliveries" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "merchant_webhook_deliveries_status_idx" ON "merchant_webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "merchants_status_idx" ON "merchants" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "order_items_order_tier_key" ON "order_items" USING btree ("order_id","tier_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_buyer_checkout_key" ON "orders" USING btree ("buyer_id","checkout_key");--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "orders_merchant_created_idx" ON "orders" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "orders_status_hold_idx" ON "orders" USING btree ("status","hold_expires_at");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_payment_idx" ON "payment_webhook_events" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_outcome_idx" ON "payment_webhook_events" USING btree ("outcome","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_merchant_idempotency_key" ON "payments" USING btree ("merchant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_merchant_created_idx" ON "payments" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "platform_fee_settings_effective_idx" ON "platform_fee_settings" USING btree ("effective_from");--> statement-breakpoint
CREATE INDEX "reconciliation_reports_merchant_idx" ON "reconciliation_reports" USING btree ("merchant_id","created_at");--> statement-breakpoint
CREATE INDEX "ticket_qr_tokens_ticket_idx" ON "ticket_qr_tokens" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_redemptions_event_idx" ON "ticket_redemptions" USING btree ("event_id","redeemed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_tiers_event_name_key" ON "ticket_tiers" USING btree ("event_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "ticket_tiers_event_code_key" ON "ticket_tiers" USING btree ("event_id","tier_code");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_payment_seq_key" ON "tickets" USING btree ("payment_id","seq");--> statement-breakpoint
CREATE INDEX "tickets_owner_idx" ON "tickets" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "tickets_event_status_idx" ON "tickets" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");