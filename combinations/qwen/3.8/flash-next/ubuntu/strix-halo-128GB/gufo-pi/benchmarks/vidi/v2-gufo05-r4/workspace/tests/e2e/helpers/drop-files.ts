/**
 * Drag-and-drop helper for E2E tests: builds a DataTransfer from fixture files
 * inside the page and dispatches dragenter/dragover/drop at a board point.
 */

import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export interface DropFilesOptions {
  /** The point at which to drop, in viewport coordinates. */
  x: number;
  y: number;
  /** File paths to include in the DataTransfer. */
  filePaths: string[];
}

/**
 * Simulate a file drag-and-drop onto the page at the given coordinates.
 * Reads the files in Node and dispatches synthetic events with a DataTransfer
 * containing the file data.
 */
export async function dropFiles(page: Page, options: DropFilesOptions): Promise<void> {
  const { x, y, filePaths } = options;

  // Read files in Node and pass them to the browser as base64
  const files = filePaths.map((path) => ({
    name: basename(path),
    data: readFileSync(path).toString('base64'),
    mimeType: mimeTypeFor(path)
  }));

  await page.evaluate(
    ({ files, x, y }) => {
      const dataTransfer = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
        const file = new File([bytes], f.name, { type: f.mimeType });
        dataTransfer.items.add(file);
      }

      const target = document.elementFromPoint(x, y) ?? document.body;

      const dragEnter = new DragEvent('dragenter', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        dataTransfer
      });
      target.dispatchEvent(dragEnter);

      const dragOver = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        dataTransfer
      });
      target.dispatchEvent(dragOver);

      const drop = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        dataTransfer
      });
      target.dispatchEvent(drop);
    },
    { files, x, y }
  );
}

function mimeTypeFor(path: string): string {
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}
