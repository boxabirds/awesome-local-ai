/**
 * E2E helper: drop files onto the board using DataTransfer.
 */
import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename_es = fileURLToPath(import.meta.url);
const __dirname_es = path.dirname(__filename_es);
const FIXTURES_DIR = path.join(__dirname_es, '../../fixtures/images');

export interface DropFile {
  name: string;
  type: string;
  buffer: Buffer;
}

/**
 * Build a DataTransfer inside the page and dispatch dragenter/dragover/drop at
 * the given screen coordinates on the board surface.
 */
export async function dropFilesOnBoard(
  page: Page,
  files: DropFile[],
  x: number,
  y: number,
): Promise<void> {
  const fileData = files.map((f) => ({
    name: f.name,
    type: f.type,
    data: f.buffer.toString('base64'),
  }));

  await page.evaluate(
    async ({ filesData, px, py }) => {
      const dt = new DataTransfer();
      for (const fd of filesData) {
        const binary = atob(fd.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], fd.name, { type: fd.type });
        dt.items.add(file);
      }

      const surface = document.querySelector('[data-board-surface]')!;
      const rect = surface.getBoundingClientRect();
      const clientX = rect.left + px;
      const clientY = rect.top + py;

      const opts = { bubbles: true, cancelable: true, clientX, clientY };
      surface.dispatchEvent(new DragEvent('dragenter', { ...opts, dataTransfer: dt }));
      surface.dispatchEvent(new DragEvent('dragover', { ...opts, dataTransfer: dt }));
      surface.dispatchEvent(new DragEvent('drop', { ...opts, dataTransfer: dt }));
    },
    { filesData: fileData, px: x, py: y },
  );
}

export function readFixture(name: string): DropFile {
  const filePath = path.join(FIXTURES_DIR, name);
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(name).toLowerCase();
  const typeMap: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };
  return { name, type: typeMap[ext] ?? 'application/octet-stream', buffer };
}
