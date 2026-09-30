import { type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FIXTURES = path.resolve(__dirname, '../../fixtures/images');

/**
 * Simulate a drag-and-drop of files onto the board viewport.
 * Builds a DataTransfer from fixture files and dispatches dragenter/dragover/drop.
 */
export async function dropFilesOnBoard(
  page: Page,
  files: string[],
  screenPoint: { x: number; y: number },
): Promise<void> {
  // Read file data as byte arrays
  const fileData = files.map((f) => {
    const filePath = path.join(FIXTURES, f);
    const buffer = fs.readFileSync(filePath);
    return {
      name: f,
      type: mimeType(f),
      bytes: Array.from(buffer),
    };
  });

  await page.evaluate((args: { fileData: { name: string; type: string; bytes: number[] }[]; x: number; y: number }) => {
    const viewport = document.querySelector('[data-testid="board-viewport"]')!;
    const dt = new DataTransfer();

    for (const fd of args.fileData) {
      const bytes = new Uint8Array(fd.bytes);
      const file = new File([bytes], fd.name, { type: fd.type });
      dt.items.add(file);
    }

    const rect = viewport.getBoundingClientRect();
    const clientX = rect.left + args.x;
    const clientY = rect.top + args.y;

    // Dispatch dragenter
    viewport.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: dt, clientX, clientY }));
    // Dispatch dragover
    viewport.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: dt, clientX, clientY }));
    // Dispatch drop
    viewport.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: dt, clientX, clientY }));
  }, { fileData, x: screenPoint.x, y: screenPoint.y });
}

function mimeType(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  if (name.endsWith('.svg')) return 'image/svg+xml';
  if (name.endsWith('.pdf')) return 'application/pdf';
  return 'application/octet-stream';
}
