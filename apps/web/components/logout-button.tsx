'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { apiFetch } from '@/lib/api';
import { Button } from './ui';

export function LogoutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await apiFetch('/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
        router.push('/');
        router.refresh();
      }}
    >
      {busy ? 'Logging out…' : 'Log out'}
    </Button>
  );
}
