// Story 12: drag files from "the computer" onto the board. Builds a real
// DataTransfer with File objects inside the page and dispatches the drag events
// a native file drag produces (dragenter, dragover, drop) at a page point.
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { Point } from '../../../src/shared/geometry';

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

/** A file from tests/fixtures/images/, typed by its extension (as an OS would). */
export function fixtureFile(name: string): FixtureFile {
  const buffer = readFileSync(new URL(`../../fixtures/images/${name}`, import.meta.url));
  return { name, mimeType: MIME[name.split('.').pop()!] ?? 'application/octet-stream', buffer };
}

declare global {
  interface Window {
    __vidi6Drag?: DataTransfer;
  }
}

/** Starts a file drag over the board at `at` (dragenter + dragover); the drop highlight shows. */
export async function dragFilesOver(page: Page, files: FixtureFile[], at: Point): Promise<void> {
  const payload = files.map((f) => ({ name: f.name, type: f.mimeType, b64: f.buffer.toString('base64') }));
  await page.evaluate(
    ({ payload, at }) => {
      const dt = new DataTransfer();
      for (const f of payload) {
        const bin = atob(f.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
      window.__vidi6Drag = dt;
      const target = document.elementFromPoint(at.x, at.y)!;
      for (const type of ['dragenter', 'dragover']) {
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: at.x, clientY: at.y }),
        );
      }
    },
    { payload, at },
  );
}

/** Drops the files of the current drag at `at`. */
export async function dropDraggedFiles(page: Page, at: Point): Promise<void> {
  await page.evaluate((at) => {
    const dt = window.__vidi6Drag!;
    const target = document.elementFromPoint(at.x, at.y)!;
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: at.x, clientY: at.y }));
    delete window.__vidi6Drag;
  }, at);
}

export async function dropFiles(page: Page, files: FixtureFile[], at: Point): Promise<void> {
  await dragFilesOver(page, files, at);
  await dropDraggedFiles(page, at);
}
