// Drops fixture files onto the board like a real drag from the desktop: builds a DataTransfer from the files inside
// the page and dispatches dragenter, dragover and drop at a page point.
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { Page } from '@playwright/test';
import type { Point } from '../../../src/shared/geometry';

export const FIXTURE_DIR = 'tests/fixtures/images';

export interface FileSpec {
  name: string;
  mimeType: string;
  base64: string;
}

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/** A fixture file (by name in tests/fixtures/images) with the type a browser would give it from its extension. */
export function fixtureFile(name: string): FileSpec {
  const bytes = readFileSync(`${FIXTURE_DIR}/${name}`);
  return { name: basename(name), mimeType: MIME[name.split('.').pop()!] ?? '', base64: bytes.toString('base64') };
}

/** Dispatches dragenter/dragover (optionally stopping there) and drop with these files at page point `at`. */
export async function dropFiles(page: Page, files: FileSpec[], at: Point, opts: { hoverOnly?: boolean } = {}) {
  await page.evaluate(
    ({ files, at, hoverOnly }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], f.name, { type: f.mimeType }));
      }
      const target = document.elementFromPoint(at.x, at.y) ?? document.body;
      const fire = (type: string) =>
        target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, dataTransfer: dt }));
      fire('dragenter');
      fire('dragover');
      if (!hoverOnly) fire('drop');
    },
    { files, at, hoverOnly: opts.hoverOnly ?? false },
  );
}
