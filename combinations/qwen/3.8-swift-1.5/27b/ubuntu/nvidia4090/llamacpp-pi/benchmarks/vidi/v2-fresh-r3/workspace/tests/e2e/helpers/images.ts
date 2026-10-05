import { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Story 12 e2e helpers: real file drops (DataTransfer), pastes and image
 * state read from the Yjs doc.
 */

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'images');

export function fixturePath(name: string): string {
  return join(FIXTURES, name);
}

export interface DropFile {
  name: string;
  type: string;
  base64: string;
}

/**
 * Waits until the board's sync connection is established (the image insert
 * flow is gated on `connected`/`confirmed`).
 */
export async function waitForConnected(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = (window as any).__vidi6?.connectionState;
      return s === 'connected' || s === 'confirmed';
    },
    undefined,
    { timeout: timeoutMs },
  );
}

/** Reads a fixture into a base64 DropFile descriptor. */
export function fixtureFile(name: string, type: string): DropFile {
  return { name, type, base64: readFileSync(fixturePath(name)).toString('base64') };
}

/**
 * Dispatches dragenter/dragover/drop with a real DataTransfer at a screen
 * point (the viewport is fixed inset 0, so screen == viewport coordinates).
 */
export async function dropFilesAt(page: Page, files: DropFile[], x: number, y: number): Promise<void> {
  await page.evaluate(
    ({ files, x, y }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
      const el = document.elementFromPoint(x, y);
      if (!el) throw new Error(`no element at (${x}, ${y})`);
      const make = (type: string) =>
        new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt });
      el.dispatchEvent(make('dragenter'));
      el.dispatchEvent(make('dragover'));
      el.dispatchEvent(make('drop'));
    },
    { files, x, y },
  );
}

/** Dispatches a window `paste` event carrying the given files. */
export async function pasteFiles(page: Page, files: DropFile[]): Promise<void> {
  await page.evaluate(
    ({ files }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.base64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: dt });
      window.dispatchEvent(event);
    },
    { files },
  );
}

export interface ImageState {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
  assetKey: string | null;
  naturalWidth: number;
  naturalHeight: number;
}

/** Reads the image objects straight from the Yjs document. */
export async function getImageState(page: Page): Promise<ImageState[]> {
  return page.evaluate(() => {
    const doc = (window as any).__vidi6.getDoc();
    const objects = doc.getMap('objects');
    return Array.from(objects.entries() as [string, any][]).filter(([, obj]) => obj.get('type') === 'image').map(
      ([id, obj]) => ({
        id,
        x: obj.get('x') as number,
        y: obj.get('y') as number,
        width: obj.get('width') as number,
        height: obj.get('height') as number,
        status: obj.get('status') as string,
        assetKey: (obj.get('assetKey') as string | null) ?? null,
        naturalWidth: obj.get('naturalWidth') as number,
        naturalHeight: obj.get('naturalHeight') as number,
      }),
    );
  });
}
