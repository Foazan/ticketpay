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
