// Story 12 e2e helper: drop real image files onto the board via synthetic
// DragEvents carrying a DataTransfer of in-page-constructed Files. Playwright
// cannot drag OS files into the page, but a constructible DataTransfer with
// genuine File bytes exercises the exact client path (drop → validate →
// decode → upload) in a real browser.

import type { Page } from '@playwright/test';

export interface DropFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

interface DropPayload {
  name: string;
  type: string;
  b64: string;
}

/**
 * Drag `files` over the board and drop them at screen point (x, y) — the
 * point where the first image's top-left corner lands (image.drop). The
 * camera must already be set by the caller.
 */
export async function dropFilesAt(
  page: Page,
  files: DropFile[],
  x: number,
  y: number,
): Promise<void> {
  const payloads: DropPayload[] = files.map((f) => ({
    name: f.name,
    type: f.type,
    b64: Buffer.from(f.bytes).toString('base64'),
  }));
  await page.evaluate(
    ({ payloads, x, y }) => {
      const toBytes = (b64: string): Uint8Array =>
        Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      for (const p of payloads) {
        dt.items.add(new File([toBytes(p.b64)], p.name, { type: p.type }));
      }
      const target = document.querySelector('[data-testid="board-root"]');
      if (!(target instanceof HTMLElement)) throw new Error('board-root not found');
      const make = (type: string): DragEvent =>
        new DragEvent(type, {
          dataTransfer: dt,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        });
      target.dispatchEvent(make('dragenter'));
      target.dispatchEvent(make('dragover'));
      target.dispatchEvent(make('drop'));
    },
    { payloads, x, y },
  );
}
