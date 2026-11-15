// TicketPay database schema (Drizzle ORM, PostgreSQL).
// Money is stored as integer rupiah. Ids are cuid2 strings.
// Column names are snake_case in the database (see `casing` in drizzle.config.ts and client.ts).
import { createId } from '@paralleldrive/cuid2';
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const id = () => text().primaryKey().$defaultFn(() => createId());
const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
const ts = () => timestamp({ withTimezone: true });

// ---------- Enums ----------

export const roleEnum = pgEnum('role', ['BUYER', 'ORGANIZER', 'GATE_STAFF', 'ADMIN']);
export const merchantStatusEnum = pgEnum('merchant_status', ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED']);
export const eventStatusEnum = pgEnum('event_status', ['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED']);
export const orderStatusEnum = pgEnum('order_status', ['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED']);
export const paymentStatusEnum = pgEnum('payment_status', [
  'PENDING',
  'PAID',
  'FAILED',
  'EXPIRED',
  'REFUND_PENDING',
  'REFUNDED',
]);
export const paymentProviderEnum = pgEnum('payment_provider', ['MOCK', 'MIDTRANS']);
export const webhookOutcomeEnum = pgEnum('webhook_event_outcome', ['APPLIED', 'DUPLICATE', 'IGNORED_STALE', 'REJECTED']);
export const webhookDeliveryStatusEnum = pgEnum('webhook_delivery_status', ['PENDING', 'DELIVERED', 'RETRYING', 'FAILED']);
export const ledgerEntryTypeEnum = pgEnum('ledger_entry_type', [
  'GROSS_SALE',
  'SERVICE_FEE',
  'PROVIDER_FEE',
  'MERCHANT_NET',
  'REFUND',
  'ADJUSTMENT',
]);
export const ledgerDirectionEnum = pgEnum('ledger_direction', ['CREDIT', 'DEBIT']);
export const ticketStatusEnum = pgEnum('ticket_status', ['ACTIVE', 'REDEEMED', 'CANCELLED', 'EXPIRED']);
export const mintStatusEnum = pgEnum('mint_status', ['PENDING', 'SUBMITTED', 'MINTED', 'FAILED']);
export const chainTxTypeEnum = pgEnum('chain_tx_type', ['MINT', 'REDEEM', 'SET_SUPPLY', 'CANCEL']);
export const chainTxStatusEnum = pgEnum('chain_tx_status', ['QUEUED', 'SUBMITTED', 'CONFIRMED', 'FAILED']);
export const redemptionChainStatusEnum = pgEnum('redemption_chain_status', ['PENDING', 'CONFIRMED', 'FAILED']);
export const redemptionMethodEnum = pgEnum('redemption_method', ['QR', 'MANUAL_CODE']);

// ---------- Identity ----------

export const users = pgTable(
  'users',
  {
    id: id(),
    email: text().notNull().unique(),
    passwordHash: text().notNull(),
    fullName: text().notNull(),
    phone: text(),
    role: roleEnum().notNull().default('BUYER'),
    // Deterministic custodial address derived server-side; holds this user's ticket tokens.
    custodialAddress: text().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts(),
  },
  (t) => [index('users_role_idx').on(t.role)],
);

// ---------- Merchant ----------

export const merchants = pgTable(
  'merchants',
  {
    id: id(),
    userId: text()
      .notNull()
      .unique()
      .references(() => users.id),
    businessName: text().notNull(),
    organizerType: text().notNull(),
    contactPerson: text().notNull(),
    phone: text().notNull(),
    address: text().notNull(),
    description: text(),
    status: merchantStatusEnum().notNull().default('PENDING'),
    statusReason: text(),
    webhookUrl: text(),
    // Encrypted with WEBHOOK_SECRET_ENC_KEY. Must be recoverable to sign outbound webhooks.
    webhookSecretEnc: text(),
    // Free text only (for example a bank name). No account numbers in the prototype.
    settlementAccountNote: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts(),
  },
  (t) => [index('merchants_status_idx').on(t.status)],
);

export const merchantApiKeys = pgTable(
  'merchant_api_keys',
  {
    id: id(),
    merchantId: text()
      .notNull()
      .references(() => merchants.id),
    // Public identifier shown in the dashboard, e.g. "tp_test_ab12cd".
    keyPrefix: text().notNull().unique(),
    // SHA-256 of the full key. The full key is shown once at creation.
    keyHash: text().notNull(),
    lastFour: text().notNull(),
    revokedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index('merchant_api_keys_merchant_idx').on(t.merchantId)],
);

// ---------- Catalog ----------

export const eventCategories = pgTable('event_categories', {
  id: id(),
  name: text().notNull().unique(),
  slug: text().notNull().unique(),
  createdAt: createdAt(),
});

export const events = pgTable(
  'events',
  {
    id: id(),
    merchantId: text()
      .notNull()
      .references(() => merchants.id),
    categoryId: text()
      .notNull()
      .references(() => eventCategories.id),
    // Numeric id used on-chain as eventId.
    onChainEventId: serial().notNull().unique(),
    title: text().notNull(),
    slug: text().notNull().unique(),
    description: text().notNull(),
    city: text().notNull(),
    venue: text().notNull(),
    startAt: ts().notNull(),
    endAt: ts().notNull(),
    posterPath: text().notNull(),
    status: eventStatusEnum().notNull().default('DRAFT'),
    isFeatured: boolean().notNull().default(false),
    requiresIdCheck: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: ts(),
  },
  (t) => [
    index('events_merchant_idx').on(t.merchantId),
    index('events_status_start_idx').on(t.status, t.startAt),
    index('events_category_idx').on(t.categoryId),
    index('events_city_idx').on(t.city),
  ],
);

export const ticketTiers = pgTable(
  'ticket_tiers',
  {
    id: id(),
    eventId: text()
      .notNull()
      .references(() => events.id),
    name: text().notNull(),
    // Small integer stored on-chain as the ticket tier.
    tierCode: integer().notNull(),
    price: integer().notNull(),
    quota: integer().notNull(),
    soldCount: integer().notNull().default(0),
    // Tickets held by PENDING orders inside their payment window.
    heldCount: integer().notNull().default(0),
    salesStartAt: ts().notNull(),
    salesEndAt: ts().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ticket_tiers_event_name_key').on(t.eventId, t.name),
    uniqueIndex('ticket_tiers_event_code_key').on(t.eventId, t.tierCode),
    // The database itself refuses to oversell, whatever the application does.
    check('ticket_tiers_no_oversell', sql`${t.soldCount} + ${t.heldCount} <= ${t.quota}`),
    check('ticket_tiers_non_negative', sql`${t.soldCount} >= 0 AND ${t.heldCount} >= 0 AND ${t.quota} >= 0 AND ${t.price} >= 0`),
  ],
);

// ---------- Sales ----------

export const orders = pgTable(
  'orders',
  {
    id: id(),
    orderNumber: text().notNull().unique(),
    buyerId: text()
      .notNull()
      .references(() => users.id),
    eventId: text()
      .notNull()
      .references(() => events.id),
    merchantId: text()
      .notNull()
      .references(() => merchants.id),
    status: orderStatusEnum().notNull().default('PENDING'),
    subtotal: integer().notNull(),
    serviceFee: integer().notNull(),
    // Fee rate used for this order, in basis points, copied from platform_fee_settings.
    feeRateBps: integer().notNull(),
    total: integer().notNull(),
    buyerName: text().notNull(),
    buyerEmail: text().notNull(),
    buyerPhone: text(),
    holdExpiresAt: ts().notNull(),
    // Generated once per checkout page load; stops a double click creating two orders.
    checkoutKey: text().notNull(),
    // True for rows created by the seed script, so demo data is never mistaken for real sales.
    isSeed: boolean().notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('orders_buyer_checkout_key').on(t.buyerId, t.checkoutKey),
    index('orders_buyer_idx').on(t.buyerId),
    index('orders_merchant_created_idx').on(t.merchantId, t.createdAt),
    index('orders_status_hold_idx').on(t.status, t.holdExpiresAt),
  ],
);

export const orderItems = pgTable(
  'order_items',
  {
    id: id(),
    orderId: text()
      .notNull()
      .references(() => orders.id),
    tierId: text()
      .notNull()
      .references(() => ticketTiers.id),
    quantity: integer().notNull(),
    unitPrice: integer().notNull(),
  },
  (t) => [
    uniqueIndex('order_items_order_tier_key').on(t.orderId, t.tierId),
    check('order_items_quantity_positive', sql`${t.quantity} > 0`),
  ],
);

// ---------- Payments ----------

export const payments = pgTable(
  'payments',
  {
    id: id(),
    orderId: text()
      .notNull()
      .unique()
      .references(() => orders.id),
    merchantId: text()
      .notNull()
      .references(() => merchants.id),
    // Sent to the provider as order_id.
    reference: text().notNull().unique(),
    idempotencyKey: text().notNull(),
    // SHA-256 of the create-payment request body, to detect key reuse with a different body.
    requestHash: text().notNull(),
    amount: integer().notNull(),
    status: paymentStatusEnum().notNull().default('PENDING'),
    provider: paymentProviderEnum().notNull(),
    providerStatus: text(),
    providerTransactionId: text(),
    paymentType: text(),
    snapToken: text(),
    redirectUrl: text(),
    paidAt: ts(),
    expiresAt: ts().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_merchant_idempotency_key').on(t.merchantId, t.idempotencyKey),
    index('payments_merchant_created_idx').on(t.merchantId, t.createdAt),
    index('payments_status_idx').on(t.status),
  ],
);

export const paymentWebhookEvents = pgTable(
  'payment_webhook_events',
  {
    id: id(),
    provider: paymentProviderEnum().notNull(),
    paymentId: text().references(() => payments.id),
    // provider + order_id + transaction_status + status_code + fraud_status
    dedupeKey: text().notNull().unique(),
    signatureValid: boolean().notNull(),
    providerStatus: text(),
    outcome: webhookOutcomeEnum().notNull(),
    // Provider payload with sensitive fields removed.
    payloadRedacted: jsonb().notNull(),
    receivedAt: createdAt(),
  },
  (t) => [
    index('payment_webhook_events_payment_idx').on(t.paymentId),
    index('payment_webhook_events_outcome_idx').on(t.outcome, t.receivedAt),
  ],
);

export const merchantWebhookDeliveries = pgTable(
  'merchant_webhook_deliveries',
  {
    id: id(),
    // Public event id sent in X-TicketPay-Event-Id.
    eventId: text().notNull().unique(),
    merchantId: text()
      .notNull()
      .references(() => merchants.id),
    paymentId: text()
      .notNull()
      .references(() => payments.id),
    eventType: text().notNull(),
    payload: jsonb().notNull(),
    status: webhookDeliveryStatusEnum().notNull().default('PENDING'),
    attemptCount: integer().notNull().default(0),
    nextAttemptAt: ts(),
    lastStatusCode: integer(),
    lastError: text(),
    deliveredAt: ts(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('merchant_webhook_deliveries_payment_type_key').on(t.paymentId, t.eventType),
    index('merchant_webhook_deliveries_merchant_idx').on(t.merchantId, t.createdAt),
    index('merchant_webhook_deliveries_status_idx').on(t.status, t.nextAttemptAt),
  ],
);

// ---------- Finance ----------

export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: id(),
    merchantId: text()
      .notNull()
      .references(() => merchants.id),
    paymentId: text()
      .notNull()
      .references(() => payments.id),
    type: ledgerEntryTypeEnum().notNull(),
    direction: ledgerDirectionEnum().notNull(),
    amount: integer().notNull(),
    description: text().notNull(),
    // "<paymentId>:<type>" for standard entries, a random id for ADJUSTMENT rows.
    // A replayed provider notification cannot write the same entry twice.
    dedupeKey: text().notNull().unique(),
    createdAt: createdAt(),
  },
  // Append-only: corrections are new ADJUSTMENT rows, never updates.
  (t) => [
    index('ledger_entries_merchant_idx').on(t.merchantId, t.createdAt),
    index('ledger_entries_payment_idx').on(t.paymentId),
    check('ledger_entries_amount_non_negative', sql`${t.amount} >= 0`),
  ],
);

export const reconciliationReports = pgTable(
  'reconciliation_reports',
  {
    id: id(),
    // Null means a platform-wide run by an administrator.
    merchantId: text().references(() => merchants.id),
    generatedById: text()
      .notNull()
      .references(() => users.id),
    periodStart: ts().notNull(),
    periodEnd: ts().notNull(),
    countsByStatus: jsonb().notNull(),
    items: jsonb().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('reconciliation_reports_merchant_idx').on(t.merchantId, t.createdAt)],
);

export const platformFeeSettings = pgTable(
  'platform_fee_settings',
  {
    id: id(),
    // Basis points of ticket subtotal. 300 = 3.00%. Illustrative, not an approved tariff.
    feeRateBps: integer().notNull(),
    effectiveFrom: ts().notNull(),
    setById: text().references(() => users.id),
    note: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index('platform_fee_settings_effective_idx').on(t.effectiveFrom),
    check('platform_fee_settings_range', sql`${t.feeRateBps} >= 0 AND ${t.feeRateBps} <= 10000`),
  ],
);

// ---------- Ticketing ----------

export const tickets = pgTable(
  'tickets',
  {
    id: id(),
    orderId: text()
      .notNull()
      .references(() => orders.id),
    orderItemId: text()
      .notNull()
      .references(() => orderItems.id),
    ownerId: text()
      .notNull()
      .references(() => users.id),
    eventId: text()
      .notNull()
      .references(() => events.id),
    tierId: text()
      .notNull()
      .references(() => ticketTiers.id),
    paymentId: text()
      .notNull()
      .references(() => payments.id),
    // Index of this ticket within its payment, starting at 1.
    seq: integer().notNull(),
    // keccak256(paymentId, merchantId, amount, seq). The only payment data that goes on-chain.
    paymentRefHash: text().notNull().unique(),
    tokenId: text().unique(),
    status: ticketStatusEnum().notNull().default('ACTIVE'),
    mintStatus: mintStatusEnum().notNull().default('PENDING'),
    // Short manual fallback code shown under the QR.
    validationCode: text().notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tickets_payment_seq_key').on(t.paymentId, t.seq),
    index('tickets_owner_idx').on(t.ownerId),
    index('tickets_event_status_idx').on(t.eventId, t.status),
  ],
);

export const ticketQrTokens = pgTable(
  'ticket_qr_tokens',
  {
    id: id(),
    ticketId: text()
      .notNull()
      .references(() => tickets.id),
    // SHA-256 of the random token. The raw token only ever exists in the QR.
    tokenHash: text().notNull().unique(),
    expiresAt: ts().notNull(),
    usedAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index('ticket_qr_tokens_ticket_idx').on(t.ticketId)],
);

export const ticketRedemptions = pgTable(
  'ticket_redemptions',
  {
    id: id(),
    // Unique: the database-level guarantee that a ticket is redeemed once.
    ticketId: text()
      .notNull()
      .unique()
      .references(() => tickets.id),
    gateStaffId: text()
      .notNull()
      .references(() => users.id),
    eventId: text()
      .notNull()
      .references(() => events.id),
    method: redemptionMethodEnum().notNull(),
    chainStatus: redemptionChainStatusEnum().notNull().default('PENDING'),
    redeemedAt: createdAt(),
  },
  (t) => [index('ticket_redemptions_event_idx').on(t.eventId, t.redeemedAt)],
);

// ---------- Chain ----------

export const blockchainTransactions = pgTable(
  'blockchain_transactions',
  {
    id: id(),
    type: chainTxTypeEnum().notNull(),
    ticketId: text().references(() => tickets.id),
    eventId: text().references(() => events.id),
    txHash: text().unique(),
    status: chainTxStatusEnum().notNull().default('QUEUED'),
    attemptCount: integer().notNull().default(0),
    errorMessage: text(),
    chainId: integer().notNull(),
    blockNumber: integer(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('blockchain_transactions_status_idx').on(t.status, t.createdAt),
    index('blockchain_transactions_ticket_idx').on(t.ticketId),
  ],
);

// ---------- Access ----------

export const gateEventPermissions = pgTable(
  'gate_event_permissions',
  {
    id: id(),
    gateStaffId: text()
      .notNull()
      .references(() => users.id),
    eventId: text()
      .notNull()
      .references(() => events.id),
    grantedById: text()
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('gate_event_permissions_staff_event_key').on(t.gateStaffId, t.eventId)],
);

// ---------- Ops ----------

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: text()
      .notNull()
      .references(() => users.id),
    type: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    readAt: ts(),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.createdAt)],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    // Null for system actions such as webhook processing.
    actorId: text().references(() => users.id),
    actorRole: text().notNull(),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    metadata: jsonb(),
    ipAddress: text(),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_created_idx').on(t.createdAt), index('audit_logs_entity_idx').on(t.entityType, t.entityId)],
);

// ---------- Relations (for the relational query API) ----------

export const usersRelations = relations(users, ({ one, many }) => ({
  merchant: one(merchants, { fields: [users.id], references: [merchants.userId] }),
  orders: many(orders),
  tickets: many(tickets),
  gatePermissions: many(gateEventPermissions, { relationName: 'gateStaff' }),
}));

export const merchantsRelations = relations(merchants, ({ one, many }) => ({
  user: one(users, { fields: [merchants.userId], references: [users.id] }),
  events: many(events),
  apiKeys: many(merchantApiKeys),
}));

export const merchantApiKeysRelations = relations(merchantApiKeys, ({ one }) => ({
  merchant: one(merchants, { fields: [merchantApiKeys.merchantId], references: [merchants.id] }),
}));

export const eventCategoriesRelations = relations(eventCategories, ({ many }) => ({
  events: many(events),
}));

export const eventsRelations = relations(events, ({ one, many }) => ({
  merchant: one(merchants, { fields: [events.merchantId], references: [merchants.id] }),
  category: one(eventCategories, { fields: [events.categoryId], references: [eventCategories.id] }),
  tiers: many(ticketTiers),
  gatePermissions: many(gateEventPermissions),
}));

export const ticketTiersRelations = relations(ticketTiers, ({ one }) => ({
  event: one(events, { fields: [ticketTiers.eventId], references: [events.id] }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  buyer: one(users, { fields: [orders.buyerId], references: [users.id] }),
  event: one(events, { fields: [orders.eventId], references: [events.id] }),
  merchant: one(merchants, { fields: [orders.merchantId], references: [merchants.id] }),
  items: many(orderItems),
  payment: one(payments, { fields: [orders.id], references: [payments.orderId] }),
  tickets: many(tickets),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  tier: one(ticketTiers, { fields: [orderItems.tierId], references: [ticketTiers.id] }),
}));

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
  merchant: one(merchants, { fields: [payments.merchantId], references: [merchants.id] }),
  ledgerEntries: many(ledgerEntries),
  tickets: many(tickets),
}));

export const ledgerEntriesRelations = relations(ledgerEntries, ({ one }) => ({
  payment: one(payments, { fields: [ledgerEntries.paymentId], references: [payments.id] }),
  merchant: one(merchants, { fields: [ledgerEntries.merchantId], references: [merchants.id] }),
}));

export const ticketsRelations = relations(tickets, ({ one }) => ({
  owner: one(users, { fields: [tickets.ownerId], references: [users.id] }),
  event: one(events, { fields: [tickets.eventId], references: [events.id] }),
  tier: one(ticketTiers, { fields: [tickets.tierId], references: [ticketTiers.id] }),
  order: one(orders, { fields: [tickets.orderId], references: [orders.id] }),
  payment: one(payments, { fields: [tickets.paymentId], references: [payments.id] }),
  redemption: one(ticketRedemptions, { fields: [tickets.id], references: [ticketRedemptions.ticketId] }),
}));

export const ticketRedemptionsRelations = relations(ticketRedemptions, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketRedemptions.ticketId], references: [tickets.id] }),
}));

export const gateEventPermissionsRelations = relations(gateEventPermissions, ({ one }) => ({
  gateStaff: one(users, { fields: [gateEventPermissions.gateStaffId], references: [users.id], relationName: 'gateStaff' }),
  event: one(events, { fields: [gateEventPermissions.eventId], references: [events.id] }),
}));
