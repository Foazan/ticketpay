import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/components/site-header';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'TicketPay — Find your next live experience', template: '%s · TicketPay' },
  description: 'Discover events across Indonesia and buy verifiable digital tickets. Academic prototype.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
