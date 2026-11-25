import type { DailySales, EventStatus, ReconRow } from './organizer';

export type MerchantStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export type AdminOverview = {
  merchants: Partial<Record<MerchantStatus, number>>;
  events: Partial<Record<EventStatus, number>>;
  payments: Record<string, number>;
  money: { gross: number; refunds: number; serviceFees: number };
  tickets: { issued: number; minted: number; mintFailed: number; redeemed: number };
  webhooks: { failed: number; retrying: number };
  dailyVolume: DailySales[];
  reconciliation: Record<ReconRow['status'], number>;
  chain: ChainStatus;
  feeRateBps: number;
};

export type ChainStatus = {
  mode: 'disabled' | 'local' | 'sepolia';
  network: string;
  ready: boolean;
  chainId: number | null;
  contractAddress: string | null;
  contractUrl: string | null;
  signer: string | null;
  problem: string | null;
  blockNumber?: number;
};

export type AdminMerchantRow = {
  id: string;
  businessName: string;
  organizerType: string;
  contactPerson: string;
  phone: string;
  status: MerchantStatus;
  statusReason: string | null;
  email: string;
  createdAt: string;
  eventCount: number;
  grossVolume: number;
};

export type AdminMerchant = {
  id: string;
  businessName: string;
  organizerType: string;
  contactPerson: string;
  phone: string;
  address: string;
  description: string | null;
  settlementAccountNote: string | null;
  status: MerchantStatus;
  statusReason: string | null;
  webhookUrl: string | null;
  createdAt: string;
  email: string;
  fullName: string;
  events: { id: string; title: string; status: EventStatus; startAt: string }[];
  activeApiKeys: number;
  paidPayments: number;
  grossVolume: number;
  history: { action: string; metadata: { from?: string; reason?: string | null } | null; createdAt: string; actor: string | null }[];
};

export type AdminEventRow = {
  id: string;
  slug: string;
  title: string;
  city: string;
  startAt: string;
  status: EventStatus;
  merchantId: string;
  merchant: string;
  merchantStatus: MerchantStatus;
  sold: number;
  quota: number;
  gateStaff: number;
};

export type AdminPaymentRow = {
  id: string;
  reference: string;
  orderNumber: string;
  buyerName: string;
  merchantId: string;
  merchant: string;
  event: string;
  amount: number;
  method: string | null;
  provider: string;
  status: string;
  providerStatus: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type ChainTx = { ticketId?: string | null; type: string; status: string; txHash: string | null; errorMessage: string | null; txUrl: string | null };

export type AdminPayment = {
  payment: { id: string; reference: string; provider: string; providerTransactionId: string | null; method: string | null; amount: number; status: string; providerStatus: string | null; paidAt: string | null; createdAt: string };
  order: { id: string; orderNumber: string; status: string; buyerName: string; subtotal: number; serviceFee: number; feeRateBps: number; total: number; createdAt: string };
  merchant: string;
  event: string;
  items: { tier: string; quantity: number; unitPrice: number }[];
  notifications: { id: string; source: string; providerStatus: string | null; outcome: string; signatureValid: boolean; receivedAt: string }[];
  ledger: { id: string; type: string; direction: 'CREDIT' | 'DEBIT'; amount: number; description: string; createdAt: string }[];
  tickets: { id: string; seq: number; status: string; mintStatus: string; tokenId: string | null; redeemedAt: string | null; redeemChainStatus: string | null; chain: ChainTx[] }[];
  deliveries: { id: string; eventType: string; status: string; attemptCount: number; lastStatusCode: number | null; lastError: string | null; createdAt: string }[];
  canRefund: boolean;
};

export type AdminLedger = {
  rows: { id: string; merchant: string; paymentReference: string; paymentId: string; type: string; direction: 'CREDIT' | 'DEBIT'; amount: number; description: string; createdAt: string }[];
  totals: { type: string; credit: number; debit: number }[];
};

export type FeeSettings = { currentRateBps: number; history: { id: string; feeRateBps: number; effectiveFrom: string; note: string | null; setBy: string | null }[] };

export type WebhookDelivery = {
  id: string;
  eventId: string;
  eventType: string;
  merchant: string;
  paymentId: string;
  paymentReference: string;
  status: 'PENDING' | 'DELIVERED' | 'RETRYING' | 'FAILED';
  attemptCount: number;
  lastStatusCode: number | null;
  lastError: string | null;
  nextAttemptAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

export type ChainMonitor = {
  status: ChainStatus;
  counts: { type: string; status: string; n: number }[];
  transactions: { id: string; type: string; status: string; ticketId: string | null; tokenId: string | null; event: string | null; txHash: string | null; blockNumber: number | null; errorMessage: string | null; createdAt: string; txUrl: string | null }[];
  failedMints: { id: string; event: string; seq: number; createdAt: string }[];
  failedRedeems: { ticketId: string; event: string; chainError: string | null; redeemedAt: string }[];
};

export type GateStaff = { id: string; fullName: string; email: string; createdAt: string; admissions: number; events: { eventId: string; title: string; startAt: string }[] };

export type AuditPage = {
  rows: { id: string; action: string; actorRole: string | null; actor: string | null; actorEmail: string | null; entityType: string; entityId: string | null; metadata: Record<string, unknown> | null; ipAddress: string | null; createdAt: string }[];
  page: number;
  pageSize: number;
  total: number;
  entityTypes: string[];
};

export const MERCHANT_BADGE: Record<MerchantStatus, { label: string; tone: 'success' | 'pending' | 'failed' | 'neutral' }> = {
  PENDING: { label: 'Awaiting approval', tone: 'pending' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'failed' },
  SUSPENDED: { label: 'Suspended', tone: 'failed' },
};

export const CHAIN_BADGE: Record<string, { label: string; tone: 'success' | 'pending' | 'failed' | 'neutral' }> = {
  QUEUED: { label: 'Queued', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'pending' },
  CONFIRMED: { label: 'Confirmed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'failed' },
  PENDING: { label: 'Pending', tone: 'pending' },
  MINTED: { label: 'Minted', tone: 'success' },
};

export const DELIVERY_BADGE: Record<WebhookDelivery['status'], { label: string; tone: 'success' | 'pending' | 'failed' | 'neutral' }> = {
  PENDING: { label: 'Queued', tone: 'neutral' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  RETRYING: { label: 'Retrying', tone: 'pending' },
  FAILED: { label: 'Gave up', tone: 'failed' },
};

export const percent = (bps: number) => `${(bps / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%`;

export const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-6)}`;

/** Builds a query string from the non-empty values. */
export function query(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => [k, String(v)])).toString();
  return qs ? `?${qs}` : '';
}
