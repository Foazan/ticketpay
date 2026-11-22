'use client';

import { CSRF_HEADER, CSRF_HEADER_VALUE, POSTER_MAX_BYTES } from '@ticketpay/shared';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { API_URL, ApiError, apiFetch } from '@/lib/api';
import { posterSrc } from '@/lib/media';
import type { OrganizerEvent } from '@/lib/organizer';
import { Button } from '../ui';

/** Publish, unpublish, archive and delete, with the API deciding what is allowed. */
export function EventActions({ event, approved }: { event: OrganizerEvent; approved: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: 'publish' | 'unpublish' | 'archive' | 'delete', confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    setError(null);
    try {
      if (action === 'delete') {
        await apiFetch(`/v1/organizer/events/${event.id}`, { method: 'DELETE' });
        router.push('/organizer/events');
        return;
      }
      await apiFetch(`/v1/organizer/events/${event.id}/${action}`, { method: 'POST' });
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(null);
    }
  };

  const canPublish = event.status === 'DRAFT' || event.status === 'UNPUBLISHED';
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        {canPublish && (
          <Button variant="accent" disabled={!!busy || !approved} onClick={() => run('publish')} title={approved ? undefined : 'Available once your account is approved'}>
            {busy === 'publish' ? 'Publishing…' : 'Publish'}
          </Button>
        )}
        {event.status === 'PUBLISHED' && (
          <Button variant="secondary" disabled={!!busy} onClick={() => run('unpublish', 'Unpublish this event? It disappears from the marketplace. Tickets already sold stay valid.')}>
            {busy === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}
          </Button>
        )}
        {canPublish && (
          <Button variant="secondary" disabled={!!busy} onClick={() => run('archive', 'Archive this event? It can no longer be edited or published.')}>
            {busy === 'archive' ? 'Archiving…' : 'Archive'}
          </Button>
        )}
        {event.canDelete && event.status !== 'PUBLISHED' && (
          <Button variant="ghost" className="text-status-danger" disabled={!!busy} onClick={() => run('delete', 'Delete this event? This cannot be undone.')}>
            {busy === 'delete' ? 'Deleting…' : 'Delete'}
          </Button>
        )}
      </div>
      {!approved && canPublish && <p className="text-caption text-ink-secondary">Publishing becomes available once TicketPay approves your organizer account.</p>}
      {error && (
        <p role="alert" className="rounded-md bg-status-danger-soft px-4 py-3 text-body-sm">
          {error}
        </p>
      )}
    </div>
  );
}

/** Poster preview and upload. The API checks the actual bytes; this only gives early feedback. */
export function PosterUpload({ event }: { event: OrganizerEvent }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = event.status === 'ARCHIVED';

  const upload = async (file: File) => {
    setError(null);
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return setError('Choose a PNG, JPEG or WebP image.');
    if (file.size > POSTER_MAX_BYTES) return setError('The poster must be 2 MB or smaller.');
    setBusy(true);
    try {
      const body = new FormData();
      body.append('poster', file);
      const res = await fetch(`${API_URL}/v1/organizer/events/${event.id}/poster`, {
        method: 'POST',
        credentials: 'include',
        headers: { [CSRF_HEADER]: CSRF_HEADER_VALUE },
        body,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new ApiError(res.status, typeof j?.message === 'string' ? j.message : 'Upload failed');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={posterSrc(event.posterPath)} alt={`Poster for ${event.title}`} className="aspect-[8/5] w-full rounded-md object-cover" />
      {!locked && (
        <>
          <input
            ref={input}
            id="poster-file"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
          <Button variant="secondary" className="w-full" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? 'Uploading…' : 'Upload poster'}
          </Button>
          <p className="text-caption text-ink-secondary">PNG, JPEG or WebP, up to 2 MB. 8:5 works best, for example 1600 × 1000.</p>
        </>
      )}
      {error && (
        <p role="alert" className="text-body-sm text-status-danger">
          {error}
        </p>
      )}
    </div>
  );
}
