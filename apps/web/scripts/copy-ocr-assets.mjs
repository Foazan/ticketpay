// Copies the OCR engine (tesseract.js worker, WebAssembly core) and the English language data into
// public/ocr, so ID cards are read entirely on the gate staff's phone with files served by TicketPay
// itself: no CDN, and the photo never leaves the device. Runs before `next dev` and `next build`.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const web = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(web, 'public', 'ocr');

const tesseract = dirname(require.resolve('tesseract.js/package.json'));
const core = dirname(createRequire(join(tesseract, 'package.json')).resolve('tesseract.js-core/package.json'));
const lang = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to) && statSync(to).size === statSync(from).size) return 0;
  copyFileSync(from, to);
  return 1;
}

let n = 0;
n += copy(join(tesseract, 'dist', 'worker.min.js'), join(out, 'worker.min.js'));
// The LSTM-only builds; the worker picks the variant the browser supports (SIMD or not).
for (const f of readdirSync(core).filter((f) => /^tesseract-core.*-lstm\.wasm(\.js)?$|^tesseract-core.*-lstm\.js$/.test(f))) {
  n += copy(join(core, f), join(out, 'core', f));
}
n += copy(join(lang, 'eng.traineddata.gz'), join(out, 'lang', 'eng.traineddata.gz'));
if (n) console.log(`OCR assets: ${n} file(s) copied to public/ocr`);
