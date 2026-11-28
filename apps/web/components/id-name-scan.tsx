'use client';

import type { IdCheckMethod } from '@ticketpay/shared';
import { ScanText } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { compareIdName, type IdNameOutcome, type IdNameResult } from '@/lib/id-name-match';
import { closeIdReader, readIdText } from '@/lib/id-ocr';
import { useHydrated } from '@/lib/use-hydrated';


const METHOD: Record<IdNameOutcome, IdCheckMethod> = { MATCH: 'OCR_MATCH', PARTIAL: 'OCR_PARTIAL', NO_MATCH: 'OCR_NO_MATCH', UNREADABLE: 'VISUAL' };

const VIEW: Record<IdNameOutcome, { title: string; tone: string; advice: string }> = {
  MATCH: { title: 'Name matches', tone: 'border-status-success bg-status-success-soft', advice: 'Now check that the photo on the card is the person in front of you.' },
  PARTIAL: { title: 'Name partly matches', tone: 'border-status-warning bg-status-warning-soft', advice: 'Compare the names by eye: a word may be missing or misread.' },
  NO_MATCH: { title: 'Name does not match', tone: 'border-status-danger bg-status-danger-soft', advice: 'Read the card yourself. If the name really differs, do not admit.' },
  UNREADABLE: { title: 'Could not read the name', tone: 'border-line bg-bg-muted', advice: 'Retake the photo flat, in good light, without glare, or compare by eye.' },
};

/**
 * Optional help for the ID check: staff photograph the card and this phone reads the name and
 * compares it with the ticket holder. Only the name is shown; the photo and the rest of the text
 * (the NIK included) are discarded at once and never sent anywhere. Staff still decide, and still
 * compare the photo with the person.
 */
export function IdNameScan({ holderName, onResult }: { holderName: string; onResult: (method: IdCheckMethod) => void }) {
  const hydrated = useHydrated();
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<{ kind: 'idle' } | { kind: 'reading'; progress: number } | { kind: 'done'; result: IdNameResult } | { kind: 'error' }>({ kind: 'idle' });

  // Release the OCR engine when the scanner page closes.
  useEffect(() => () => void closeIdReader(), []);

  const onFile = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setState({ kind: 'reading', progress: 0 });
    try {
      const text = await readIdText(file, (p) => setState({ kind: 'reading', progress: p }));
      const result = compareIdName(holderName, text);
      setState({ kind: 'done', result });
      onResult(METHOD[result.outcome]);
    } catch {
      setState({ kind: 'error' });
      onResult('VISUAL');
    }
  };

  const busy = state.kind === 'reading';
  return (
    <div className="space-y-3 rounded-md border border-line p-3" data-id-scan={state.kind === 'done' ? state.result.outcome : state.kind}>
      <div className="flex flex-wrap items-center gap-3">
        <label
          htmlFor={inputId}
          aria-disabled={busy || !hydrated}
          className={`inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-bg-surface px-4 py-2 text-label hover:bg-bg-muted ${busy || !hydrated ? 'pointer-events-none opacity-60' : ''}`}
        >
          <ScanText size={18} aria-hidden />
          {state.kind === 'idle' ? 'Read name from ID card' : 'Read another photo'}
        </label>
        <input
          ref={input}
          id={inputId}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          disabled={busy || !hydrated}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <span className="text-caption text-ink-secondary">Optional. The photo is read on this phone, never uploaded or stored.</span>
      </div>

      {busy && (
        <p role="status" className="text-body-sm text-ink-secondary">
          Reading the card{state.progress > 0 ? ` (${Math.round(state.progress * 100)}%)` : '. The first time loads the reader, about 4 MB'}…
        </p>
      )}
      {state.kind === 'error' && (
        <p role="alert" className="text-body-sm text-status-danger">
          The reader could not start on this device. Compare the name by eye.
        </p>
      )}
      {state.kind === 'done' && (
        <div role="status" className={`space-y-1 rounded-md border-l-4 px-3 py-2 text-body-sm ${VIEW[state.result.outcome].tone}`}>
          <p className="text-label">{VIEW[state.result.outcome].title}</p>
          {state.result.readName && (
            <p>
              Card reads <span className="font-medium">{state.result.readName}</span> · ticket holder <span className="font-medium">{holderName}</span>
            </p>
          )}
          <p className="text-ink-secondary">{VIEW[state.result.outcome].advice}</p>
        </div>
      )}
    </div>
  );
}
