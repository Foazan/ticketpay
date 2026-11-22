import type { Metadata } from 'next';
import Link from 'next/link';
import { EventForm } from '@/components/organizer/event-form';
import { PageHeader } from '@/components/organizer/page-header';
import { serverFetch } from '@/lib/api';

export const metadata: Metadata = { title: 'Create event' };

export default async function NewEvent() {
  const categories = await serverFetch<{ id: string; name: string }[]>('/v1/categories');
  return (
    <>
      <Link href="/organizer/events" className="text-body-sm text-ink-accent hover:underline">
        ← Events
      </Link>
      <PageHeader title="Create event" intro="Start with the details. You add ticket categories and a poster on the next screen, then publish when ready." />
      <div className="card max-w-3xl p-6">
        <EventForm categories={categories} />
      </div>
    </>
  );
}
