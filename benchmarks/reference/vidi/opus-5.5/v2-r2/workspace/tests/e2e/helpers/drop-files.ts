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

/** A file from `tests/fixtures/images/`, typed by its extension (as a browser would). */
export function fixtureImage(name: string): FixtureFile {
  const buffer = readFileSync(new URL(`../../fixtures/images/${name}`, import.meta.url));
  return { name, mimeType: MIME[name.split('.').pop() ?? ''] ?? 'application/octet-stream', buffer };
}

/**
 * Builds a DataTransfer from `files` inside the page and dispatches dragenter,
 * dragover and drop on the board at the page point `at`, as a real file drop from
 * the desktop would. `beforeDrop` runs while the files hover over the board.
 */
export async function dropFiles(
  page: Page,
  files: readonly FixtureFile[],
  at: { x: number; y: number },
  beforeDrop?: () => Promise<void>,
): Promise<void> {
  const payload = files.map((f) => ({ name: f.name, mimeType: f.mimeType, base64: f.buffer.toString('base64') }));
  const handle = await page.evaluateHandle((items) => {
    const transfer = new DataTransfer();
    for (const item of items) {
      const binary = atob(item.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      transfer.items.add(new File([bytes], item.name, { type: item.mimeType }));
    }
    return transfer;
  }, payload);
  const viewport = page.getByTestId('board-viewport');
  const init = { dataTransfer: handle, clientX: at.x, clientY: at.y };
  await viewport.dispatchEvent('dragenter', init);
  await viewport.dispatchEvent('dragover', init);
  await beforeDrop?.();
  await viewport.dispatchEvent('drop', init);
  await handle.dispose();
}
