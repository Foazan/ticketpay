// Generated event posters: a gradient per category with the title. Used for the seeded events and as
// the default poster of a new event until the organizer uploads one.

const PALETTE: Record<string, [string, string]> = {
  'Music & Concert': ['#3B1D8F', '#D6336C'],
  Technology: ['#0B3D91', '#0E9AA0'],
  Sports: ['#0B6E4F', '#C2D11B'],
  'Art & Culture': ['#7A2E0E', '#E8A33D'],
  'Workshop & Seminar': ['#14315C', '#5B8DEF'],
  Festival: ['#B3261E', '#F2A93B'],
  'Community Event': ['#1F6F78', '#7BD389'],
};
const FALLBACK: [string, string] = ['#0B1F3A', '#0E9AA0'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Breaks a title into at most four lines of about 18 characters. */
function wrap(title: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of title.split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > 18) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > 4) return [...lines.slice(0, 3), `${lines[3]}…`];
  return lines;
}

export function posterSvg(title: string, category: string): string {
  const [a, b] = PALETTE[category] ?? FALLBACK;
  const lines = wrap(title);
  const startY = 420 - (lines.length - 1) * 58;
  const text = lines.map((l, i) => `<text x="48" y="${startY + i * 58}" font-size="50" font-weight="700" fill="#ffffff">${esc(l)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 500" width="800" height="500" font-family="Inter, Arial, sans-serif">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect width="800" height="500" fill="url(#g)"/>
<circle cx="680" cy="110" r="170" fill="#ffffff" fill-opacity="0.08"/><circle cx="740" cy="400" r="110" fill="#ffffff" fill-opacity="0.06"/>
<text x="48" y="${startY - 70}" font-size="22" font-weight="600" fill="#ffffff" fill-opacity="0.85">${esc(category.toUpperCase())}</text>
${text}
</svg>
`;
}
