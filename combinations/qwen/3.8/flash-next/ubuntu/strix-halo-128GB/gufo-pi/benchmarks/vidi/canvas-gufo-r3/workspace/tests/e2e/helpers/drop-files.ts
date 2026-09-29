import { Page, Locator } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Simulates a file drop by building a DataTransfer inside the page
 * and dispatching dragenter/dragover/drop events.
 */
export async function dropFiles(
  page: Page,
  target: Locator,
  files: { name: string; mimeType: string; buffer: Buffer }[],
  position?: { x: number; y: number },
): Promise<void> {
  const fileData = files.map((f) => ({
    name: f.name,
    mimeType: f.mimeType,
    base64: f.buffer.toString('base64'),
  }));

  const box = await target.boundingBox();
  if (!box) throw new Error('Target not found');
  const x = position?.x ?? box.x + box.width / 2;
  const y = position?.y ?? box.y + box.height / 2;

  await page.evaluate(
    ({ fileData, x, y }) => {
      const dt = new DataTransfer();
      for (const fd of fileData) {
        const bytes = Uint8Array.from(atob(fd.base64), (c) => c.charCodeAt(0));
        const file = new File([bytes], fd.name, { type: fd.mimeType });
        dt.items.add(file);
      }

      const el = document.elementFromPoint(x, y)!;
      const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y };

      // Create a proper DragEvent with dataTransfer
      const dragEnter = new DragEvent('dragenter', { ...opts, dataTransfer: dt });
      const dragOver = new DragEvent('dragover', { ...opts, dataTransfer: dt });
      const drop = new DragEvent('drop', { ...opts, dataTransfer: dt });

      el.dispatchEvent(dragEnter);
      el.dispatchEvent(dragOver);
      el.dispatchEvent(drop);
    },
    { fileData, x, y },
  );
}

/**
 * Read an image fixture file and return it as a drop-able object.
 */
export function readFixture(name: string): { name: string; mimeType: string; buffer: Buffer } {
  const filePath = path.resolve(__dirname, '../fixtures/images', name);
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(name).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return { name, mimeType: mimeTypes[ext] || 'application/octet-stream', buffer };
}
