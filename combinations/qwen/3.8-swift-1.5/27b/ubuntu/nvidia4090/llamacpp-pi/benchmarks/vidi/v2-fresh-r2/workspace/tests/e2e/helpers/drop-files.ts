/**
 * E2E helper: dispatch a file drag-drop onto the board (story 12, image.insert).
 *
 * Builds a `DataTransfer` from fixture bytes inside the page and dispatches
 * dragenter/dragover/drop at a board point. The BoardPage listens for the
 * native `drop` on its (position:fixed, inset:0) shell, so dispatching on the
 * topmost element under the point bubbles up to that handler.
 */
import type { Page } from '@playwright/test';

export interface DropFile {
  name: string;
  type: string;
  base64: string;
}

/** Convert a Node Buffer to a base64 string for the drop helper. */
export function toBase64(buf: Buffer): string {
  return buf.toString('base64');
}

export async function dropFiles(
  page: Page,
  files: DropFile[],
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(
    ({ files, x, y }) => {
      const makeFile = (f: DropFile): File => {
        const bin = atob(f.base64);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new File([arr], f.name, { type: f.type });
      };
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(makeFile(f));
      const el = document.elementFromPoint(x, y) ?? document.body;
      el.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt }));
      el.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt }));
    },
    { files, x, y },
  );
}
