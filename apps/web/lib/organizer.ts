export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED';

export type OrganizerEventRow = {
  id: string;
  slug: string;
  title: string;
  city: string;
  venue: string;
  startAt: string;
  endAt: string;
  status: EventStatus;
  posterPath: string;
  tierCount: number;
  sold: number;
  quota: number;
  revenue: number;
};

export type Tier = {
  id: string;
  name: string;
  tierCode: number;
  price: number;
  quota: number;
  soldCount: number;
  heldCount: number;
  salesStartAt: string;
  salesEndAt: string;
};

export type OrganizerEvent = {
  id: string;
  slug: string;
  title: string;
  categoryId: string;
  categoryName: string;
  description: string;
  city: string;
  venue: string;
  startAt: string;
  endAt: string;
  status: EventStatus;
  posterPath: string;
  requiresIdCheck: boolean;
  tiers: Tier[];
  orderCount: number;
  canDelete: boolean;
};

export type DailySales = { date: string; tickets: number; revenue: number };

export type Overview = {
  totalEvents: number;
  publishedEvents: number;
  ticketsSold: number;
  totalRevenue: number;
  pendingPayments: number;
  estimatedBalance: number;
  recentTransactions: { orderId: string; orderNumber: string; buyerName: string; event: string; total: number; status: string; createdAt: string }[];
  dailySales: DailySales[];
  upcomingEvents: { id: string; title: string; startAt: string; status: EventStatus; sold: number; quota: number }[];
};

export type Transaction = {
  orderId: string;
  orderNumber: string;
  buyerName: string;
  eventId: string;
  event: string;
  ticketTypes: string | null;
  quantity: number;
  subtotal: number;
  serviceFee: number;
  total: number;
  orderStatus: string;
  paymentId: string | null;
  paymentReference: string | null;
  paymentStatus: string | null;
  provider: string | null;
  providerStatus: string | null;
  method: string | null;
  paidAt: string | null;
  ticketsIssued: number;
  ticketsMinted: number;
  createdAt: string;
};

export type Analytics = {
  days: number;
  byTier: { eventId: string; eventTitle: string; eventStatus: EventStatus; startAt: string; tierId: string; tierName: string; price: number; quota: number; sold: number; held: number; revenue: number }[];
  daily: DailySales[];
  paymentMethods: { method: string; count: number; amount: number }[];
  feeBreakdown: { gross: number; serviceFee: number; providerFee: number | null; organizerNet: number };
};

export type LedgerEntry = { id: string; paymentId: string; paymentReference: string; type: string; direction: 'CREDIT' | 'DEBIT'; amount: number; description: string; createdAt: string };

export type ReconRow = {
  paymentId: string;
  reference: string;
  orderNumber: string;
  eventTitle: string;
  amount: number;
  provider: string;
  providerStatus: string | null;
  paymentStatus: string;
  orderStatus: string;
  ledger: { gross: number | null; serviceFee: number | null; merchantNet: number | null };
  tickets: { expected: number; issued: number; minted: number; failed: number; pending: number };
  duplicateNotifications: number;
  status: 'MATCHED' | 'PENDING' | 'MISMATCH' | 'INVESTIGATE';
  findings: string[];
  createdAt: string;
};
export type Reconciliation = { rows: ReconRow[]; summary: Record<ReconRow['status'], number>; chainEnabled: boolean };

export type MerchantProfile = {
  id: string;
  businessName: string;
  organizerType: string;
  contactPerson: string;
  phone: string;
  address: string;
  description: string | null;
  settlementAccountNote: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';
  statusReason: string | null;
  webhookUrl: string | null;
  hasWebhookSecret: boolean;
  createdAt: string;
};

export type Integration = {
  activeApiKeys: number;
  webhookConfigured: boolean;
  webhookSecretSet: boolean;
  deliveriesLast7Days: { total: number; delivered: number; failed: number };
  lastDeliveryStatus: string | null;
};

export type ApiKey = { id: string; keyPrefix: string; lastFour: string; createdAt: string; revokedAt: string | null };

export const EVENT_STATUS_BADGE: Record<EventStatus, { label: string; tone: 'success' | 'pending' | 'neutral' | 'info' }> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PUBLISHED: { label: 'On sale', tone: 'success' },
  UNPUBLISHED: { label: 'Unpublished', tone: 'pending' },
  ARCHIVED: { label: 'Archived', tone: 'neutral' },
};

/** Value for an <input type="datetime-local"> in Jakarta time. */
export function toLocalInput(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 16);
}

/** Reads an <input type="datetime-local"> value as Jakarta time (UTC+7, no daylight saving). */
export function fromLocalInput(value: string): string {
  return new Date(`${value}:00+07:00`).toISOString();
}

export const compactRupiah = (n: number) =>
  n >= 1_000_000_000 ? `Rp ${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, '')}B` : n >= 1_000_000 ? `Rp ${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M` : n >= 1_000 ? `Rp ${Math.round(n / 1_000)}K` : `Rp ${n}`;
