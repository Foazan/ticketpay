import type { ReactNode } from 'react';

/** A plain data table that scrolls sideways on small screens instead of squashing columns. */
export function DataTable({ caption, head, children, empty }: { caption: string; head: ReactNode; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[56rem] text-body-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-bg-muted text-left text-label text-ink-secondary">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-line">{children}</tbody>
      </table>
      {empty}
    </div>
  );
}

export const Th = ({ children, right }: { children: ReactNode; right?: boolean }) => <th className={`px-4 py-3 font-medium ${right ? 'text-right' : ''}`}>{children}</th>;
export const Td = ({ children, right, mono }: { children: ReactNode; right?: boolean; mono?: boolean }) => (
  <td className={`px-4 py-3 align-top ${right ? 'text-right tabular-nums' : ''} ${mono ? 'font-mono text-caption' : ''}`}>{children}</td>
);
