// Types and validation schemas shared by the API and the web app.
import { z } from 'zod';

export const ROLES = ['BUYER', 'ORGANIZER', 'GATE_STAFF', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const MERCHANT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const;
export type MerchantStatus = (typeof MERCHANT_STATUSES)[number];

/** Where each role lands after login. */
export const ROLE_HOME: Record<Role, string> = {
  BUYER: '/buyer/tickets',
  ORGANIZER: '/organizer',
  GATE_STAFF: '/gate',
  ADMIN: '/admin',
};

/** Header every state-changing browser request must send (CSRF defence). */
export const CSRF_HEADER = 'x-ticketpay-csrf';
export const CSRF_HEADER_VALUE = '1';

const email = z.string().trim().toLowerCase().email().max(254);
const password = z.string().min(8, 'Password must be at least 8 characters').max(128);

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof loginSchema>;

export const registerSchema = z.object({
  email,
  password,
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20).optional(),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const registerOrganizerSchema = registerSchema.extend({
  businessName: z.string().trim().min(2).max(160),
  organizerType: z.string().trim().min(2).max(80),
  contactPerson: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20),
  address: z.string().trim().min(5).max(300),
  description: z.string().trim().max(1000).optional(),
  settlementAccountNote: z.string().trim().max(200).optional(),
});
export type RegisterOrganizerInput = z.infer<typeof registerOrganizerSchema>;

export const EVENT_SORTS = ['date_asc', 'date_desc', 'price_asc', 'price_desc', 'popular'] as const;
export const eventQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  city: z.string().trim().max(60).optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  featured: z.enum(['true', 'false']).optional(),
  sort: z.enum(EVENT_SORTS).default('date_asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(12),
});
export type EventQuery = z.infer<typeof eventQuerySchema>;

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  merchant: { id: string; businessName: string; status: MerchantStatus } | null;
}

export interface EventSummary {
  id: string;
  slug: string;
  title: string;
  category: { name: string; slug: string };
  city: string;
  venue: string;
  startAt: string;
  endAt: string;
  posterPath: string;
  organizer: string;
  isFeatured: boolean;
  fromPrice: number | null;
  ticketsAvailable: number;
}

export interface TicketTierView {
  id: string;
  name: string;
  price: number;
  quota: number;
  available: number;
  salesStartAt: string;
  salesEndAt: string;
  onSale: boolean;
}

export interface EventDetail extends EventSummary {
  description: string;
  requiresIdCheck: boolean;
  tiers: TicketTierView[];
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Formats integer rupiah as "Rp150.000". */
export function formatRupiah(amount: number): string {
  return 'Rp' + Math.round(amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ---------- Checkout, orders and payments ----------

export const MAX_TICKETS_PER_ORDER = 6;
/** How long tickets are held while the buyer pays. Also sent to Midtrans as the payment expiry. */
export const HOLD_MINUTES = 15;

export const PAYMENT_METHODS = ['VA', 'QRIS', 'EWALLET'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, { title: string; description: string }> = {
  VA: { title: 'Virtual Account', description: 'Bank transfer to a one-time account number' },
  QRIS: { title: 'QRIS', description: 'Scan with any QRIS-enabled app' },
  EWALLET: { title: 'E-wallet', description: 'GoPay or ShopeePay' },
};

export type OrderStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUNDED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'EXPIRED' | 'REFUND_PENDING' | 'REFUNDED';

const orderItems = z
  .array(z.object({ tierId: z.string().min(1).max(40), quantity: z.number().int().min(1).max(MAX_TICKETS_PER_ORDER) }))
  .min(1)
  .max(5)
  .refine((items) => new Set(items.map((i) => i.tierId)).size === items.length, 'Each ticket category may appear once')
  .refine((items) => items.reduce((n, i) => n + i.quantity, 0) <= MAX_TICKETS_PER_ORDER, `At most ${MAX_TICKETS_PER_ORDER} tickets per order`);

/** "tierId:qty,tierId:qty" as used in the checkout URL. */
export function parseItemsParam(param: string | undefined): { tierId: string; quantity: number }[] {
  if (!param) return [];
  return param
    .split(',')
    .map((part) => part.split(':'))
    .filter(([id, q]) => id && /^\d+$/.test(q ?? ''))
    .map(([tierId, q]) => ({ tierId, quantity: Number(q) }));
}

export const quoteSchema = z.object({ eventSlug: z.string().trim().min(1).max(200), items: orderItems });
export type QuoteInput = z.infer<typeof quoteSchema>;

export const createOrderSchema = quoteSchema.extend({
  // Generated once per checkout page load; a repeat with the same key returns the same order.
  checkoutKey: z.string().trim().min(8).max(64),
  buyerName: z.string().trim().min(2).max(120),
  buyerEmail: z.string().trim().toLowerCase().email().max(254),
  buyerPhone: z.string().trim().min(8).max(20).optional(),
});
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const createPaymentSchema = z.object({ orderId: z.string().min(1).max(40), method: z.enum(PAYMENT_METHODS) });
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export interface QuoteLine {
  tierId: string;
  tierName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface Quote {
  event: { id: string; slug: string; title: string; startAt: string; city: string; venue: string; posterPath: string };
  lines: QuoteLine[];
  subtotal: number;
  feeRateBps: number;
  serviceFee: number;
  total: number;
}

export interface OrderView {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  event: { title: string; slug: string; startAt: string; city: string; venue: string };
  lines: QuoteLine[];
  subtotal: number;
  feeRateBps: number;
  serviceFee: number;
  total: number;
  holdExpiresAt: string;
  createdAt: string;
  payment: {
    id: string;
    reference: string;
    status: PaymentStatus;
    method: PaymentMethod;
    provider: 'MOCK' | 'MIDTRANS';
    paymentType: string | null;
    redirectUrl: string | null;
    paidAt: string | null;
    expiresAt: string;
  } | null;
  tickets: { issued: number; minted: number };
}

export interface PaymentView {
  id: string;
  reference: string;
  orderId: string;
  merchantId: string;
  amount: number;
  status: PaymentStatus;
  method: PaymentMethod;
  provider: 'MOCK' | 'MIDTRANS';
  providerStatus: string | null;
  snapToken: string | null;
  redirectUrl: string | null;
  paidAt: string | null;
  expiresAt: string;
  createdAt: string;
}

/** Service fee in integer rupiah: rate in basis points of the ticket subtotal, rounded half up. */
export function computeServiceFee(subtotal: number, feeRateBps: number): number {
  return Math.floor((subtotal * feeRateBps + 5000) / 10000);
}

// ---------- Outbound merchant webhooks ----------

export const WEBHOOK_EVENT_TYPES = ['payment.paid', 'payment.failed', 'payment.expired'] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export const WEBHOOK_HEADERS = {
  eventId: 'x-ticketpay-event-id',
  timestamp: 'x-ticketpay-timestamp',
  signature: 'x-ticketpay-signature',
} as const;
/** Receivers should reject deliveries whose timestamp is older than this. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

// ---------- QR and gate ----------

/** Prefix of every ticket QR payload. The rest is an opaque random token: no ids, no personal data. */
export const QR_PREFIX = 'TP1.';
/** A QR token is accepted for this long after it is issued. */
export const QR_TTL_SECONDS = 90;
/** The ticket page fetches a fresh QR this often, so a screenshot stops working quickly. */
export const QR_REFRESH_SECONDS = 30;

export interface TicketQr {
  /** The exact text to encode in the QR code. */
  qr: string;
  expiresAt: string;
  refreshInSeconds: number;
}

/**
 * Normalises a manual validation code as typed by gate staff: case, spaces and dashes don't matter,
 * and the look-alike letters O, I and L are read as 0, 1 and 1 (Crockford base32).
 */
export function normalizeValidationCode(raw: string): string | null {
  let s = raw
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (s.length === 10 && s.startsWith('TP')) s = s.slice(2);
  if (!/^[0-9A-HJKMNP-TV-Z]{8}$/.test(s)) return null;
  return `TP-${s.slice(0, 4)}-${s.slice(4)}`;
}

export const gateCheckSchema = z
  .object({
    eventId: z.string().trim().min(1).max(64),
    qr: z.string().trim().max(200).optional(),
    code: z.string().trim().max(40).optional(),
  })
  .refine((v) => Boolean(v.qr) !== Boolean(v.code), { message: 'Send either a scanned QR or a manual code, not both' });
export type GateCheckInput = z.infer<typeof gateCheckSchema>;

export const GATE_OUTCOMES = [
  'VALID',
  'ADMITTED',
  'ALREADY_REDEEMED',
  'INVALID',
  'EXPIRED',
  'WRONG_EVENT',
  'NOT_PAID',
  'CANCELLED',
  'OWNERSHIP_MISMATCH',
] as const;
export type GateOutcome = (typeof GATE_OUTCOMES)[number];

/** What the gate screen shows. Only what staff need to admit someone: no email, phone or payment data. */
export interface GateResult {
  outcome: GateOutcome;
  /** True for VALID and ADMITTED. */
  ok: boolean;
  message: string;
  method?: 'QR' | 'MANUAL_CODE';
  ticket?: {
    id: string;
    holderName: string;
    tierName: string;
    seq: number;
    eventTitle: string;
    tokenId: string | null;
  };
  redeemedAt?: string;
  redeemedBy?: string;
  /** Whether the NFT is held by the holder's custodial address. SKIPPED when the chain is off, not minted yet or unreachable. */
  chainOwner?: 'MATCH' | 'MISMATCH' | 'SKIPPED';
}

// ---------- Organizer: events and tiers ----------

/** Validation shared by the event form and the API. Dates are ISO strings from the browser. */
const eventFields = {
  title: z.string().trim().min(4, 'Use at least 4 characters').max(120),
  categoryId: z.string().trim().min(1, 'Choose a category').max(40),
  description: z.string().trim().min(20, 'Describe the event in at least 20 characters').max(4000),
  city: z.string().trim().min(2).max(60),
  venue: z.string().trim().min(2).max(160),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  requiresIdCheck: z.boolean().default(false),
};

export const createEventSchema = z
  .object(eventFields)
  .refine((e) => e.endAt > e.startAt, { message: 'The event must end after it starts', path: ['endAt'] })
  .refine((e) => e.startAt.getTime() > Date.now(), { message: 'The event must start in the future', path: ['startAt'] });
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z
  .object(eventFields)
  .partial()
  .refine((e) => !(e.startAt && e.endAt) || e.endAt > e.startAt, { message: 'The event must end after it starts', path: ['endAt'] });
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

/** Prices in whole rupiah. Payment providers need a positive amount, so free tickets are not supported. */
export const MIN_TICKET_PRICE = 1_000;
export const MAX_TICKET_PRICE = 100_000_000;
export const MAX_TIER_QUOTA = 100_000;
/** The tier code is a uint8 on-chain. */
export const MAX_TIERS_PER_EVENT = 20;

const tierFields = {
  name: z.string().trim().min(2).max(60),
  price: z.coerce.number().int().min(MIN_TICKET_PRICE, `The minimum price is Rp ${MIN_TICKET_PRICE.toLocaleString('id-ID')}`).max(MAX_TICKET_PRICE),
  quota: z.coerce.number().int().min(1, 'At least 1 ticket').max(MAX_TIER_QUOTA),
  salesStartAt: z.coerce.date(),
  salesEndAt: z.coerce.date(),
};
export const tierSchema = z.object(tierFields).refine((t) => t.salesEndAt > t.salesStartAt, { message: 'Sales must end after they start', path: ['salesEndAt'] });
export type TierInput = z.infer<typeof tierSchema>;
export const updateTierSchema = z
  .object(tierFields)
  .partial()
  .refine((t) => !(t.salesStartAt && t.salesEndAt) || t.salesEndAt > t.salesStartAt, { message: 'Sales must end after they start', path: ['salesEndAt'] });
export type UpdateTierInput = z.infer<typeof updateTierSchema>;

export const merchantProfileSchema = z.object({
  contactPerson: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20),
  address: z.string().trim().min(5).max(300),
  description: z.string().trim().max(1000).optional().default(''),
  // Free text such as a bank name. Never account numbers in this prototype.
  settlementAccountNote: z.string().trim().max(200).optional().default(''),
});
export type MerchantProfileInput = z.infer<typeof merchantProfileSchema>;

export const POSTER_MAX_BYTES = 2 * 1024 * 1024;
export const POSTER_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

/** Reconciliation result for one payment (section 6.6). */
export const RECON_STATUSES = ['MATCHED', 'PENDING', 'MISMATCH', 'INVESTIGATE'] as const;
export type ReconStatus = (typeof RECON_STATUSES)[number];
