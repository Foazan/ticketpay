'use client';

import type { Worker } from 'tesseract.js';

/**
 * Reads the text on a photo of an ID card, entirely in this browser. The engine and language data
 * are served by TicketPay from /ocr (see scripts/copy-ocr-assets.mjs) and loaded on first use only;
 * the photo itself is never uploaded, stored or logged.
 */

let workerPromise: Promise<Worker> | null = null;
let progressListener: ((p: number) => void) | null = null;

function getWorker(onProgress?: (p: number) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM } = await import('tesseract.js');
      return createWorker('eng', OEM.LSTM_ONLY, {
        workerPath: '/ocr/worker.min.js',
        corePath: '/ocr/core',
        langPath: '/ocr/lang',
        workerBlobURL: false,
        logger: (m) => {
          if (m.status === 'recognizing text') progressListener?.(m.progress);
        },
      });
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  progressListener = onProgress ?? null;
  return workerPromise;
}

/** Scales the photo to a size OCR handles well and turns it into high-contrast grey. */
async function prepare(file: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  try {
    // Around 1600 px across: phone photos are larger than needed, screenshots smaller.
    const scale = Math.min(2.5, 1600 / bitmap.width);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.filter = 'grayscale(1) contrast(1.4)';
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas;
  } finally {
    bitmap.close();
  }
}

/** The card's text. The caller keeps only the name it extracts and drops the rest. */
export async function readIdText(file: Blob, onProgress?: (p: number) => void): Promise<string> {
  const [worker, canvas] = await Promise.all([getWorker(onProgress), prepare(file)]);
  try {
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    // Clear the pixels so no copy of the card stays in memory longer than needed.
    canvas.width = 0;
    canvas.height = 0;
    progressListener = null;
  }
}

/** Frees the engine (a few MB) when the scanner page closes. */
export async function closeIdReader() {
  const w = workerPromise;
  workerPromise = null;
  if (w) await (await w).terminate().catch(() => undefined);
}
