/**
 * Story 12 e2e helper: drops fixture files onto the board like a drag from the desktop. The
 * files are rebuilt inside the page as real `File`s in a real `DataTransfer`, and
 * dragenter / dragover / drop are dispatched on the board viewport at a screen point.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { Point } from '../../../src/client/canvas/camera';

/** Playwright runs from the repository root. */
export const IMAGE_FIXTURES = path.resolve('tests/fixtures/images');

export interface FixtureFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
};

/** A file from tests/fixtures/images/, typed by its extension (as a desktop drag would be). */
export function fixture(name: string): FixtureFile {
  return { name, mimeType: MIME[path.extname(name)] ?? 'application/octet-stream', buffer: readFileSync(path.join(IMAGE_FIXTURES, name)) };
}

/** Drags `files` over the board and drops them at `at` (screen px); `drop: false` stops after dragover. */
export async function dropFiles(page: Page, files: readonly FixtureFile[], at: Point, opts: { drop?: boolean } = {}): Promise<void> {
  const payload = files.map((f) => ({ name: f.name, type: f.mimeType, base64: f.buffer.toString('base64') }));
  await page.evaluate(
    ({ payload, at, drop }) => {
      const dt = new DataTransfer();
      for (const f of payload) {
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
      const target = document.querySelector('[data-testid="board-viewport"]')!;
      const fire = (type: string) =>
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, dataTransfer: dt }));
      fire('dragenter');
      fire('dragover');
      if (drop) fire('drop');
    },
    { payload, at, drop: opts.drop ?? true },
  );
}
