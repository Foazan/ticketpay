/**
 * Compares the name read from a photo ID (by OCR on the gate staff's phone) with the ticket holder's
 * account name. Pure functions, no I/O. OCR on a laminated card is noisy, so matching is per word and
 * tolerates a misread letter; the result is advice for staff, never a decision.
 */

export type IdNameOutcome = 'MATCH' | 'PARTIAL' | 'NO_MATCH' | 'UNREADABLE';

export interface IdNameResult {
  outcome: IdNameOutcome;
  /** The name as read from the card (only the name: never the ID number or anything else). */
  readName: string | null;
}

/** Upper case Latin letters and single spaces: "Rania  Putri-S." → "RANIA PUTRI S". */
export function normalizeName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z]+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** Same word, allowing one misread letter in words of 4–7 letters and two in longer ones. */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const len = Math.max(a.length, b.length);
  if (len < 4) return false;
  return levenshtein(a, b) <= (len >= 8 ? 2 : 1);
}

/** Names have no digits, so a digit in the name line is a misread letter (RAN1A → RANIA). */
const DIGIT_AS_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '3': 'E', '4': 'A', '5': 'S', '6': 'G', '7': 'T', '8': 'B', '9': 'G' };
const fixDigits = (s: string) => s.replace(/[0-9]/g, (d) => DIGIT_AS_LETTER[d]);

const words = (s: string) => normalizeName(s).split(' ').filter((w) => w.length >= 2);

/**
 * The value of the "Nama" line on an Indonesian KTP (also works for "Name" on other cards). OCR often
 * misreads the label ("Narna", "Nam a"), so it is matched loosely, and the value may wrap onto the
 * next line when the label stands alone.
 */
export function extractName(ocrText: string): string | null {
  const lines = ocrText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const m = /^[^A-Za-z]{0,3}(n\s?a\s?(?:m|rn|n)\s?[ae])\b\s*[:;.=\-]?\s*(.*)$/i.exec(lines[i]);
    if (!m) continue;
    let value = normalizeName(fixDigits(m[2]));
    if (!value && lines[i + 1]) value = normalizeName(fixDigits(lines[i + 1]));
    // Drop stray one-letter pieces that OCR adds around the colon.
    value = value
      .split(' ')
      .filter((w) => w.length >= 2)
      .join(' ');
    if (value) return value;
  }
  return null;
}

/** OCR sometimes breaks a word in two ("LES TARY"): rejoin neighbours that only match together. */
function mergeSplitWords(card: string[], holder: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < card.length; i++) {
    const joined = card[i] + (card[i + 1] ?? '');
    const alone = (w: string) => holder.some((h) => sameWord(h, w));
    if (card[i + 1] && !alone(card[i]) && !alone(card[i + 1]) && alone(joined)) {
      out.push(joined);
      i++;
    } else out.push(card[i]);
  }
  return out;
}

/**
 * MATCH: every word of the holder's name is on the card, and the card's name has no extra words.
 * PARTIAL: at least half of the words agree (a middle name missing, a word misread twice).
 * NO_MATCH: a name was read and it is someone else's. UNREADABLE: no usable text.
 */
export function compareIdName(holderName: string, ocrText: string): IdNameResult {
  const holder = words(holderName);
  const readName = extractName(ocrText);
  if (holder.length === 0) return { outcome: 'UNREADABLE', readName };

  if (readName) {
    const card = mergeSplitWords(readName.split(' '), holder);
    const holderFound = holder.filter((h) => card.some((c) => sameWord(h, c))).length;
    const cardFound = card.filter((c) => holder.some((h) => sameWord(h, c))).length;
    if (holderFound === holder.length && cardFound === card.length) return { outcome: 'MATCH', readName };
    if (holderFound / holder.length >= 0.5 || cardFound / card.length >= 0.5) return { outcome: 'PARTIAL', readName };
    return { outcome: 'NO_MATCH', readName };
  }

  // No "Nama" line found: look for the holder's words anywhere in the text.
  const all = words(ocrText);
  if (all.length < 3) return { outcome: 'UNREADABLE', readName: null };
  const found = holder.filter((h) => all.some((w) => sameWord(h, w))).length;
  if (found === holder.length) return { outcome: 'PARTIAL', readName: null };
  return { outcome: 'UNREADABLE', readName: null };
}
