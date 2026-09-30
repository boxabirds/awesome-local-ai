// Real drag-and-drop of files onto the board: a DataTransfer is built inside the page from
// fixture bytes and dragenter/dragover/drop are dispatched at a page point.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

export interface FixtureFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** A file from tests/fixtures/images (type from its extension, as a browser would guess it). */
export function fixture(name: string): FixtureFile {
  const buffer = readFileSync(new URL(`../../fixtures/images/${name}`, import.meta.url));
  return { name, mimeType: MIME[name.split('.').pop()!] ?? 'application/octet-stream', buffer };
}

/** Drags `files` over the board and drops them at page point `at`. */
export async function dropFiles(page: Page, files: FixtureFile[], at: { x: number; y: number }) {
  const payload = files.map((f) => ({ name: f.name, type: f.mimeType, data: f.buffer.toString('base64') }));
  await page.evaluate(
    ({ payload, at }) => {
      const dt = new DataTransfer();
      for (const f of payload) {
        const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
      const target = document.elementFromPoint(at.x, at.y) ?? document.body;
      const init = { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, dataTransfer: dt };
      target.dispatchEvent(new DragEvent('dragenter', init));
      target.dispatchEvent(new DragEvent('dragover', init));
      target.dispatchEvent(new DragEvent('drop', init));
    },
    { payload, at },
  );
}
