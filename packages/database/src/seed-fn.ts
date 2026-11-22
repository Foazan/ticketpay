// Fictional demonstration data. No real people, organizers or events.
import * as argon2 from 'argon2';
import { sql } from 'drizzle-orm';
import type { Database } from './client';
import { encryptSecret, generateWebhookSecret } from './crypto';
import { eq } from 'drizzle-orm';
import {
  eventCategories,
  events,
  gateEventPermissions,
  merchants,
  platformFeeSettings,
  ticketTiers,
  users,
} from './schema';

/** Local development password shared by every demo account. Never use outside development. */
export const DEMO_PASSWORD = 'TicketPay123!';

export const DEMO_ACCOUNTS = [
  { role: 'BUYER', email: 'buyer@ticketpay.example', fullName: 'Rania Putri' },
  { role: 'ORGANIZER', email: 'organizer@ticketpay.example', fullName: 'Laras Wijaya' },
  { role: 'GATE_STAFF', email: 'gate@ticketpay.example', fullName: 'Gate Staff Satu' },
  { role: 'ADMIN', email: 'admin@ticketpay.example', fullName: 'Platform Admin' },
] as const;

const CATEGORIES = [
  'Music & Concert',
  'Technology',
  'Sports',
  'Art & Culture',
  'Workshop & Seminar',
  'Festival',
  'Community Event',
] as const;

type TierSeed = { name: string; price: number; quota: number };
type EventSeed = {
  title: string;
  category: (typeof CATEGORIES)[number];
  city: string;
  venue: string;
  start: string;
  end: string;
  merchant: 'arunika' | 'nusa' | 'garuda';
  featured?: boolean;
  requiresIdCheck?: boolean;
  description: string;
  tiers: TierSeed[];
};

// Times are WIB (UTC+07:00).
const EVENTS: EventSeed[] = [
  {
    title: 'Soundwave Festival 2026',
    category: 'Music & Concert',
    city: 'Malang',
    venue: 'Lapangan Rampal',
    start: '2026-12-19T15:00:00+07:00',
    end: '2026-12-19T23:00:00+07:00',
    merchant: 'arunika',
    featured: true,
    requiresIdCheck: true,
    description:
      'A one-day open-air festival with twelve Indonesian indie and pop acts on two stages, a food court run by local vendors and a late-night electronic set.',
    tiers: [
      { name: 'Regular', price: 150_000, quota: 1000 },
      { name: 'VIP', price: 350_000, quota: 150 },
    ],
  },
  {
    title: 'TechConnect Indonesia',
    category: 'Technology',
    city: 'Jakarta',
    venue: 'Balai Konvensi Senayan',
    start: '2027-01-14T09:00:00+07:00',
    end: '2027-01-14T17:00:00+07:00',
    merchant: 'nusa',
    featured: true,
    description:
      'A full-day technology conference on cloud, AI and digital payments with talks from Indonesian engineers and a hallway of startup booths.',
    tiers: [
      { name: 'Student', price: 75_000, quota: 300 },
      { name: 'Professional', price: 200_000, quota: 400 },
    ],
  },
  {
    title: 'National Badminton Open',
    category: 'Sports',
    city: 'Surabaya',
    venue: 'GOR Kertajaya',
    start: '2027-01-22T10:00:00+07:00',
    end: '2027-01-24T20:00:00+07:00',
    merchant: 'garuda',
    featured: true,
    description:
      'Three days of singles and doubles matches between regional clubs, with the finals on Sunday evening.',
    tiers: [
      { name: 'Tribune', price: 100_000, quota: 800 },
      { name: 'Courtside', price: 250_000, quota: 120 },
    ],
  },
  {
    title: 'Artspace Exhibition',
    category: 'Art & Culture',
    city: 'Yogyakarta',
    venue: 'Galeri Taman Budaya',
    start: '2027-02-06T10:00:00+07:00',
    end: '2027-02-07T20:00:00+07:00',
    merchant: 'arunika',
    featured: true,
    description:
      'A weekend exhibition of contemporary painting, installation and print work by young artists from Java and Bali.',
    tiers: [
      { name: 'General Admission', price: 50_000, quota: 600 },
      { name: 'Guided Tour', price: 95_000, quota: 80 },
    ],
  },
  {
    title: 'Startup & Innovation Summit',
    category: 'Workshop & Seminar',
    city: 'Malang',
    venue: 'Graha Cakrawala',
    start: '2027-02-10T08:30:00+07:00',
    end: '2027-02-10T16:30:00+07:00',
    merchant: 'nusa',
    description:
      'Founders, investors and students meet for panels on fundraising, product discovery and building teams outside Jakarta.',
    tiers: [
      { name: 'Regular', price: 85_000, quota: 500 },
      { name: 'Regular + Workshop', price: 160_000, quota: 100 },
    ],
  },
  {
    title: 'Malang Food & Culture Fest',
    category: 'Festival',
    city: 'Malang',
    venue: 'Alun-Alun Tugu',
    start: '2027-02-20T10:00:00+07:00',
    end: '2027-02-21T22:00:00+07:00',
    merchant: 'arunika',
    description:
      'Two days of East Javanese street food, traditional dance and craft stalls around the city square.',
    tiers: [
      { name: 'Day Pass', price: 35_000, quota: 2000 },
      { name: 'Weekend Pass', price: 60_000, quota: 500 },
    ],
  },
  {
    title: 'Indie Music Night',
    category: 'Music & Concert',
    city: 'Bandung',
    venue: 'Gedung Dago Tea House',
    start: '2027-02-26T19:00:00+07:00',
    end: '2027-02-26T23:30:00+07:00',
    merchant: 'arunika',
    description: 'An intimate evening with five independent bands from Bandung and Malang.',
    tiers: [
      { name: 'Regular', price: 90_000, quota: 400 },
      { name: 'Front Row', price: 175_000, quota: 60 },
    ],
  },
  {
    title: 'Digital Marketing Bootcamp',
    category: 'Workshop & Seminar',
    city: 'Jakarta',
    venue: 'Ruang Kolaborasi Kuningan',
    start: '2027-03-06T09:00:00+07:00',
    end: '2027-03-06T17:00:00+07:00',
    merchant: 'nusa',
    description:
      'A hands-on one-day bootcamp covering content planning, paid social and measuring campaign results for small businesses.',
    tiers: [
      { name: 'Regular', price: 120_000, quota: 150 },
      { name: 'Regular + Certificate', price: 180_000, quota: 50 },
    ],
  },
  {
    title: 'Indonesia Basketball Championship',
    category: 'Sports',
    city: 'Jakarta',
    venue: 'Hall Basket Senayan',
    start: '2027-03-14T13:00:00+07:00',
    end: '2027-03-14T21:00:00+07:00',
    merchant: 'garuda',
    description: 'Semi-finals and final of an inter-city club basketball championship.',
    tiers: [
      { name: 'Tribune', price: 80_000, quota: 1200 },
      { name: 'Lower Bowl', price: 180_000, quota: 300 },
      { name: 'Courtside', price: 400_000, quota: 40 },
    ],
  },
  {
    title: 'Creative Photography Workshop',
    category: 'Workshop & Seminar',
    city: 'Malang',
    venue: 'Studio Kayutangan',
    start: '2027-03-20T09:00:00+07:00',
    end: '2027-03-20T15:00:00+07:00',
    merchant: 'nusa',
    description:
      'A small-group workshop on street and portrait photography with a guided photo walk through Kayutangan Heritage.',
    tiers: [
      { name: 'Participant', price: 65_000, quota: 40 },
      { name: 'Participant + Print', price: 110_000, quota: 15 },
    ],
  },
  {
    title: 'Java Cultural Performance',
    category: 'Art & Culture',
    city: 'Yogyakarta',
    venue: 'Pendopo Taman Siswa',
    start: '2027-03-27T19:00:00+07:00',
    end: '2027-03-27T21:30:00+07:00',
    merchant: 'arunika',
    description: 'An evening of gamelan, wayang orang and classical Javanese dance.',
    tiers: [
      { name: 'Regular', price: 60_000, quota: 350 },
      { name: 'Premium Seat', price: 125_000, quota: 70 },
    ],
  },
  {
    title: 'Campus Creative Week',
    category: 'Community Event',
    city: 'Malang',
    venue: 'Gedung Serbaguna Kampus',
    start: '2027-04-05T09:00:00+07:00',
    end: '2027-04-09T17:00:00+07:00',
    merchant: 'garuda',
    description:
      'A week of student exhibitions, short film screenings and a closing music night organised by campus communities.',
    tiers: [
      { name: 'Daily Pass', price: 25_000, quota: 1500 },
      { name: 'Week Pass', price: 90_000, quota: 300 },
    ],
  },
];

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

export const SEED_EVENTS = EVENTS.map((e) => ({ title: e.title, slug: slugify(e.title), category: e.category }));

export async function seedDatabase(db: Database) {
  if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed a production database.');

  // Start clean so the seed can be re-run.
  await db.execute(sql`
    TRUNCATE TABLE audit_logs, notifications, gate_event_permissions, blockchain_transactions,
      ticket_redemptions, ticket_qr_tokens, tickets, platform_fee_settings, reconciliation_reports,
      ledger_entries, merchant_webhook_deliveries, payment_webhook_events, payments, order_items,
      orders, ticket_tiers, events, event_categories, merchant_api_keys, merchants, users
    RESTART IDENTITY CASCADE`);

  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });
  const user = async (email: string, fullName: string, role: 'BUYER' | 'ORGANIZER' | 'GATE_STAFF' | 'ADMIN', phone?: string) => {
    const [row] = await db.insert(users).values({ email, fullName, role, passwordHash, phone }).returning();
    return row;
  };

  const buyer = await user('buyer@ticketpay.example', 'Rania Putri', 'BUYER', '081200001234');
  const buyer2 = await user('buyer2@ticketpay.example', 'Bima Santoso', 'BUYER', '081200005678');
  const organizer = await user('organizer@ticketpay.example', 'Laras Wijaya', 'ORGANIZER', '081300001111');
  const organizer2 = await user('organizer2@ticketpay.example', 'Dewi Anggraini', 'ORGANIZER', '081300002222');
  const organizer3 = await user('organizer3@ticketpay.example', 'Yoga Hartono', 'ORGANIZER', '081300003333');
  const organizer4 = await user('organizer4@ticketpay.example', 'Satria Nugraha', 'ORGANIZER', '081300004444');
  const gate = await user('gate@ticketpay.example', 'Gate Staff Satu', 'GATE_STAFF');
  const gate2 = await user('gate2@ticketpay.example', 'Gate Staff Dua', 'GATE_STAFF');
  const admin = await user('admin@ticketpay.example', 'Platform Admin', 'ADMIN');

  const merchant = async (
    userId: string,
    businessName: string,
    organizerType: string,
    contactPerson: string,
    phone: string,
    address: string,
    description: string,
    status: 'PENDING' | 'APPROVED',
  ) => {
    const [row] = await db
      .insert(merchants)
      .values({ userId, businessName, organizerType, contactPerson, phone, address, description, status })
      .returning();
    return row;
  };

  const m = {
    arunika: await merchant(organizer.id, 'Arunika Live Entertainment', 'Event promoter', 'Laras Wijaya', '081300001111', 'Jl. Kawi 12, Malang', 'Promoter for concerts, festivals and cultural performances.', 'APPROVED'),
    nusa: await merchant(organizer2.id, 'Nusa Konferensi', 'Conference organizer', 'Dewi Anggraini', '081300002222', 'Jl. Rasuna Said 5, Jakarta', 'Runs technology conferences, seminars and workshops.', 'APPROVED'),
    garuda: await merchant(organizer3.id, 'Garuda Sport & Community', 'Sports and community organizer', 'Yoga Hartono', '081300003333', 'Jl. Dharmahusada 20, Surabaya', 'Organizes sports tournaments and campus community events.', 'APPROVED'),
  };
  // Arunika sends its payment webhooks to the API's built-in demo receiver, which verifies the HMAC.
  const encKey = process.env.WEBHOOK_SECRET_ENC_KEY;
  if (encKey) {
    const apiUrl = process.env.API_PUBLIC_URL ?? `http://localhost:${process.env.API_PORT ?? 4000}`;
    await db
      .update(merchants)
      .set({ webhookUrl: `${apiUrl}/v1/dev/webhook-receiver`, webhookSecretEnc: encryptSecret(generateWebhookSecret(), encKey) })
      .where(eq(merchants.id, m.arunika.id));
  }
  await merchant(organizer4.id, 'Pentas Kota Nusantara', 'Event promoter', 'Satria Nugraha', '081300004444', 'Jl. Braga 8, Bandung', 'New promoter waiting for administrator approval.', 'PENDING');

  const categoryRows = await db
    .insert(eventCategories)
    .values(CATEGORIES.map((name) => ({ name, slug: slugify(name) })))
    .returning();
  const categoryId = Object.fromEntries(categoryRows.map((c) => [c.name, c.id]));

  const salesStart = new Date('2026-11-01T10:00:00+07:00');
  let tierCount = 0;
  const eventIdBySlug: Record<string, string> = {};
  for (const e of EVENTS) {
    const slug = slugify(e.title);
    const startAt = new Date(e.start);
    const [row] = await db
      .insert(events)
      .values({
        merchantId: m[e.merchant].id,
        categoryId: categoryId[e.category],
        title: e.title,
        slug,
        description: `${e.description} This is a fictional demonstration event.`,
        city: e.city,
        venue: e.venue,
        startAt,
        endAt: new Date(e.end),
        posterPath: `/posters/${slug}.svg`,
        status: 'PUBLISHED',
        isFeatured: e.featured ?? false,
        requiresIdCheck: e.requiresIdCheck ?? false,
      })
      .returning();
    eventIdBySlug[slug] = row.id;
    // Sales close at 23:59 WIB the day before the event starts.
    const salesEndAt = new Date(startAt.getTime());
    salesEndAt.setUTCHours(16, 59, 0, 0);
    if (salesEndAt >= startAt) salesEndAt.setUTCDate(salesEndAt.getUTCDate() - 1);
    await db.insert(ticketTiers).values(
      e.tiers.map((t, i) => ({
        eventId: row.id,
        name: t.name,
        tierCode: i + 1,
        price: t.price,
        quota: t.quota,
        salesStartAt: salesStart,
        salesEndAt,
      })),
    );
    tierCount += e.tiers.length;
  }

  // 3.00% of ticket subtotal. Illustrative prototype assumption, not an approved tariff.
  await db.insert(platformFeeSettings).values({
    feeRateBps: 300,
    effectiveFrom: new Date('2026-11-01T00:00:00+07:00'),
    setById: admin.id,
    note: 'Initial illustrative prototype rate',
  });

  await db.insert(gateEventPermissions).values([
    { gateStaffId: gate.id, eventId: eventIdBySlug['soundwave-festival-2026'], grantedById: admin.id },
    { gateStaffId: gate.id, eventId: eventIdBySlug['indie-music-night'], grantedById: admin.id },
    { gateStaffId: gate2.id, eventId: eventIdBySlug['soundwave-festival-2026'], grantedById: admin.id },
  ]);

  return {
    users: 9,
    merchants: 4,
    events: EVENTS.length,
    tiers: tierCount,
    ids: { buyer: buyer.id, buyer2: buyer2.id, organizer: organizer.id, organizer2: organizer2.id, gate: gate.id, admin: admin.id },
  };
}
