'use client';

import { Button } from '@/components/ui';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="container-page py-16">
      <div className="card mx-auto flex max-w-xl flex-col items-center gap-4 p-10 text-center">
        <h1 className="text-h3">Something went wrong</h1>
        <p className="text-body-sm text-ink-secondary">
          TicketPay could not load this page. If you are running the project locally, check that the API is running on port 4000 and that PostgreSQL is up.
        </p>
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  );
}
