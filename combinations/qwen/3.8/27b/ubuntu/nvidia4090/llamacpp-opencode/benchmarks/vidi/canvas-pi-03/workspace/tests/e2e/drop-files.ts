import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Story 12 e2e helper: drops the given host fixture files onto the board
 * viewport at a client-space point. Builds a real DataTransfer from the file
 * bytes (read here, decoded in the page) and dispatches native
 * dragenter/dragover/drop — the viewport's native listeners (BoardViewport)
 * read `e.dataTransfer.files` and `e.clientX/Y`.
 */
const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

export async function dropFilesAt(page: Page, filePaths: string[], x: number, y: number): Promise<void> {
  const payloads = filePaths.map((p) => ({
    name: path.basename(p),
    type: MIME[path.extname(p).toLowerCase()] ?? 'application/octet-stream',
    data: readFileSync(p).toString('base64'),
  }));
  await page.evaluate(
    ({ payloads, x, y }) => {
      const toBuffer = (b64: string): ArrayBuffer => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes.buffer;
      };
      const files = payloads.map((pl) => new File([toBuffer(pl.data)], pl.name, { type: pl.type }));
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      const el = document.querySelector('[data-testid="board-viewport"]');
      if (!el) throw new Error('board-viewport not found');
      const base: DragEventInit = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, view: window };
      el.dispatchEvent(new DragEvent('dragenter', { ...base, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent('dragover', { ...base, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent('drop', { ...base, dataTransfer: dt }));
    },
    { payloads, x, y },
  );
}
