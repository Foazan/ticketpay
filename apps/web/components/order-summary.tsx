import { formatRupiah, type QuoteLine } from '@ticketpay/shared';

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className={strong ? 'text-title' : 'text-body-sm text-ink-secondary'}>{label}</span>
      <span className={strong ? 'text-h3' : 'text-label'}>{value}</span>
    </div>
  );
}

/** The fee is always shown as its own line, with the rate it was charged at. */
export function OrderSummary(props: {
  title: string;
  subtitle: string;
  posterPath?: string;
  lines: QuoteLine[];
  subtotal: number;
  feeRateBps: number;
  serviceFee: number;
  total: number;
  footnote?: string;
}) {
  return (
    <div className="card flex flex-col gap-4 p-6 shadow-card">
      <h2 className="text-h3">Order summary</h2>
      <div className="flex items-center gap-4">
        {props.posterPath && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={props.posterPath} alt="" className="h-16 w-16 rounded-md object-cover" />
        )}
        <div>
          <p className="text-title">{props.title}</p>
          <p className="text-body-sm text-ink-secondary">{props.subtitle}</p>
        </div>
      </div>
      <hr className="border-bg-muted" />
      {props.lines.map((l) => (
        <Row key={l.tierId} label={`${l.tierName} × ${l.quantity}`} value={formatRupiah(l.lineTotal)} />
      ))}
      <Row label="Ticket subtotal" value={formatRupiah(props.subtotal)} />
      <Row label={`Platform service fee (${(props.feeRateBps / 100).toLocaleString('id-ID', { maximumFractionDigits: 2 })}%)`} value={formatRupiah(props.serviceFee)} />
      <hr className="border-bg-muted" />
      <Row label="Total" value={formatRupiah(props.total)} strong />
      {props.footnote && <p className="text-caption text-ink-muted">{props.footnote}</p>}
    </div>
  );
}
