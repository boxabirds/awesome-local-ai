/**
 * E2E helper: simulate file drop via DataTransfer inside the browser page.
 */
import { type Page, type Locator } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FIXTURES = path.resolve(__dirname, '../../fixtures/images');

/**
 * Drop files onto the board at a given screen position.
 * Builds a DataTransfer from fixture files inside the page.
 */
export async function dropFiles(
  page: Page,
  boardEl: Locator,
  files: { name: string; type: string; path: string }[],
  x: number,
  y: number,
): Promise<void> {
  // Read file data in Node and pass to browser
  const fileData = files.map((f) => {
    const buf = fs.readFileSync(path.join(FIXTURES, f.path));
    return { name: f.name, type: f.type, data: Array.from(buf) };
  });

  const box = await boardEl.boundingBox();
  if (!box) throw new Error('board not visible');

  await page.evaluate(
    async ({ fileData, x, y }) => {
      const dt = new DataTransfer();
      for (const fd of fileData) {
        const bytes = new Uint8Array(fd.data);
        const file = new File([bytes], fd.name, { type: fd.type });
        dt.items.add(file);
      }

      const board = document.querySelector('[data-testid="board-viewport"]')!;

      const enterEvent = new DragEvent('dragenter', {
        bubbles: true,
        dataTransfer: dt,
        clientX: x,
        clientY: y,
      });
      board.dispatchEvent(enterEvent);

      const overEvent = new DragEvent('dragover', {
        bubbles: true,
        dataTransfer: dt,
        clientX: x,
        clientY: y,
      });
      board.dispatchEvent(overEvent);

      const dropEvent = new DragEvent('drop', {
        bubbles: true,
        dataTransfer: dt,
        clientX: x,
        clientY: y,
      });
      // Set offsetX/offsetY (not settable, but our handler uses e.offsetX from the event)
      Object.defineProperty(dropEvent, 'offsetX', { value: x - board.getBoundingClientRect().left });
      Object.defineProperty(dropEvent, 'offsetY', { value: y - board.getBoundingClientRect().top });
      board.dispatchEvent(dropEvent);
    },
    { fileData, x: x + box.x, y: y + box.y },
  );
}
