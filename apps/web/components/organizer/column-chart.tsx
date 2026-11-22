'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export type Column = { key: string; label: string; value: number };

type Props = {
  /** One series, so no legend: the card title names what is plotted. */
  data: Column[];
  formatValue: (n: number) => string;
  formatTick: (n: number) => string;
  /** Accessible name and table caption. */
  title: string;
  /** Show every nth x label. */
  labelEvery?: number;
  height?: number;
  /** Shown over the empty plot when every value is zero. */
  emptyText?: string;
};

const ACCENT = '#0E9AA0';
const ACCENT_HOVER = '#0B7F85';
const GRID = '#E2E8F0';
const MAX_BAR = 24;
const GAP = 2;
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };

/** Rounds the axis maximum up to a clean step: 1, 2, 2.5 or 5 times a power of ten. */
function niceMax(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough)!;
  return { top: Math.ceil(max / step) * step, step };
}

/**
 * A single-series column chart: thin columns with a 4px rounded data end, a hairline grid,
 * a per-column tooltip on hover and keyboard focus, and a table view so no value is hover-only.
 */
export function ColumnChart({ data, formatValue, formatTick, title, labelEvery = 1, height = 220, emptyText }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { top, step } = useMemo(() => niceMax(Math.max(0, ...data.map((d) => d.value))), [data]);
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const band = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(MAX_BAR, band - GAP));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const total = data.reduce((s, d) => s + d.value, 0);
  // Keep x labels at least ~56px apart, however narrow the chart gets.
  const every = Math.max(labelEvery, Math.ceil(56 / band));
  const a = active != null ? data[active] : null;

  return (
    <div className="space-y-3">
      <div ref={wrap} className="relative" onPointerLeave={() => setActive(null)}>
        <svg width={width} height={height} role="img" aria-label={`${title}. Total ${formatValue(total)}. Use the table view for every value.`} className="block">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-ink-muted text-[11px]">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = PAD.left + i * band + (band - barW) / 2;
            const h = Math.max(0, y(0) - y(d.value));
            const r = Math.min(4, barW / 2, h);
            // Rounded at the data end only, square at the baseline.
            const path =
              h <= 0
                ? ''
                : `M${x},${y(0)} V${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} H${x + barW - r} Q${x + barW},${y(d.value)} ${x + barW},${y(d.value) + r} V${y(0)} Z`;
            return (
              <g key={d.key}>
                {path && <path d={path} fill={active === i ? ACCENT_HOVER : ACCENT} />}
                {/* The hit target is the whole band, not just the painted column. */}
                <rect
                  x={PAD.left + i * band}
                  y={PAD.top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.label}: ${formatValue(d.value)}`}
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="outline-none focus-visible:stroke-ink-primary"
                />
                {i % every === 0 && (
                  <text x={PAD.left + i * band + band / 2} y={height - 8} textAnchor="middle" className="fill-ink-muted text-[11px]">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        {emptyText && total === 0 && (
          <p className="pointer-events-none absolute inset-x-0 text-center text-body-sm text-ink-secondary" style={{ top: PAD.top + plotH / 2 - 10, paddingLeft: PAD.left }}>
            {emptyText}
          </p>
        )}
        {a && active != null && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-md border border-line bg-bg-surface px-3 py-2 shadow-card"
            style={{ left: Math.min(width - 70, Math.max(70, PAD.left + active * band + band / 2)), top: Math.max(0, y(a.value) - 56) }}
          >
            <p className="text-title">{formatValue(a.value)}</p>
            <p className="text-caption text-ink-secondary">{a.label}</p>
          </div>
        )}
      </div>
      <button type="button" className="text-body-sm text-ink-accent hover:underline" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
        {showTable ? 'Hide table' : 'Show as table'}
      </button>
      {showTable && (
        <div className="max-h-64 overflow-auto rounded-md border border-line">
          <table className="w-full text-body-sm">
            <caption className="sr-only">{title}</caption>
            <thead className="sticky top-0 bg-bg-muted text-left">
              <tr>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.key} className="border-t border-line">
                  <td className="px-3 py-1.5">{d.label}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatValue(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Sold vs quota as a meter: accent fill on a lighter track of the same hue, with the numbers beside it. */
export function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 min-w-[6rem] flex-1 rounded-full bg-accent-teal-soft" role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
        <div className="h-2 rounded-full bg-accent-teal" style={{ width: `${pct}%` }} />
      </div>
      <span className="w-24 shrink-0 text-right text-caption tabular-nums text-ink-secondary">
        {value.toLocaleString('id-ID')} / {max.toLocaleString('id-ID')}
      </span>
    </div>
  );
}
