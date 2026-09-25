/**
 * Drops files on the board the way a browser does for a drag from the desktop (story 12): a
 * real DataTransfer holding real File objects, built inside the page from fixture bytes, and
 * dragenter / dragover / drop DragEvents at a point on the board.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { fixturePath, IMAGE_FIXTURES, type ImageFixture } from '../../fixtures/images';

export interface DropFile {
  name: string;
  type: string;
  base64: string;
}

export function fixtureDropFile(name: ImageFixture): DropFile {
  const f = IMAGE_FIXTURES[name];
  return { name: f.file, type: f.type, base64: readFileSync(fixturePath(name)).toString('base64') };
}

/** Dispatches a file drag-and-drop of `files` on the board at page point `at`. */
export async function dropFiles(page: Page, files: readonly DropFile[], at: { x: number; y: number }): Promise<void> {
  await page.getByTestId('board-viewport').evaluate(
    (el, { files: list, at: p }) => {
      const dt = new DataTransfer();
      for (const f of list) {
        const bin = atob(f.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
      const init = { dataTransfer: dt, clientX: p.x, clientY: p.y, bubbles: true, cancelable: true };
      el.dispatchEvent(new DragEvent('dragenter', init));
      el.dispatchEvent(new DragEvent('dragover', init));
      el.dispatchEvent(new DragEvent('drop', init));
    },
    { files, at },
  );
}
