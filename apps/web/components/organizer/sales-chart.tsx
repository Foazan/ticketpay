'use client';

import { formatRupiah } from '@ticketpay/shared';
import { compactRupiah, type DailySales } from '@/lib/organizer';
import { ColumnChart } from './column-chart';

const label = (date: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));

/** Daily ticket revenue or tickets sold. One measure per chart, never two axes. */
export function SalesChart({ data, measure, title }: { data: DailySales[]; measure: 'revenue' | 'tickets'; title: string }) {
  const columns = data.map((d) => ({ key: d.date, label: label(d.date), value: d[measure] }));
  return (
    <ColumnChart
      title={title}
      data={columns}
      emptyText="No paid orders in this period yet"
      labelEvery={Math.max(1, Math.ceil(data.length / 6))}
      formatValue={measure === 'revenue' ? formatRupiah : (n) => `${n.toLocaleString('id-ID')} tickets`}
      formatTick={measure === 'revenue' ? (n) => (n === 0 ? '0' : compactRupiah(n)) : (n) => n.toLocaleString('id-ID')}
    />
  );
}
