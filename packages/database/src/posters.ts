// Generates one local SVG poster per seeded event into apps/web/public/posters.
// Local files mean the marketplace never depends on an external image URL.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { posterSvg } from './poster-svg';
import { SEED_EVENTS } from './seed-fn';

const out = resolve(__dirname, '../../../apps/web/public/posters');
mkdirSync(out, { recursive: true });
for (const e of SEED_EVENTS) writeFileSync(resolve(out, `${e.slug}.svg`), posterSvg(e.title, e.category));
console.log(`Wrote ${SEED_EVENTS.length} posters to ${out}`);
