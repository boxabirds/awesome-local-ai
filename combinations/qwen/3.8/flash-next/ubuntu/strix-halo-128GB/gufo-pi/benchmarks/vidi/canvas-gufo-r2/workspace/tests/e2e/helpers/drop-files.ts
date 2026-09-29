/**
 * E2E helpers for story 12 — images on the board.
 *
 * Boards are created through the real API before the browser visits them, so a
 * test can put two contexts on the same board (`/b/<id>` alone would show
 * "board not found"). Files reach the page in two ways:
 *
 *  - `dropFiles`: a hidden `<input type="file">` is filled with fixture files,
 *    its `File` objects are copied into a `DataTransfer`, and drag events are
 *    dispatched at a point of the board — the same code path as a real drop.
 *  - the picker: Playwright intercepts the `filechooser` event opened by the
 *    Image button or the `I` key (see the specs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
// Registers the `window.__vidi6` type declaration.
import '../../../src/client/canvas/testHooks';

export const FIXTURE_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'images');

export function fixturePath(name: string): string {
  return path.join(FIXTURE_DIR, name);
}

export function fixtureBuffer(name: string): Buffer {
  return fs.readFileSync(fixturePath(name));
}

export interface ImageBox {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
}

/** Create a board through the API and return its id. */
export async function createBoard(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/boards');
  if (res.status() !== 201) {
    throw new Error(`POST /api/boards responded ${res.status()}, expected 201`);
  }
  const body = (await res.json()) as { id: string };
  return body.id;
}

/** Open a board and wait until it is live. */
export async function openBoard(page: Page, boardId: string): Promise<void> {
  await page.goto(`/b/${boardId}`);
  await expect(page.getByTestId('board')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => window.__vidi6?.connectionState), { timeout: 15_000 })
    .toBe('connected');
}

const INJECTOR_ID = 'e2e-file-injector';

/**
 * Drop fixture files at a board point (screen coordinates).
 * `files` are absolute paths; pass `mimeTypes` to override what the browser
 * reports for a file (e.g. a PDF that was renamed to .png).
 */
export async function dropFiles(
  page: Page,
  files: Array<string | { path: string; mimeType?: string }>,
  at: { x: number; y: number },
): Promise<void> {
  await page.evaluate((id) => {
    if (document.getElementById(id)) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.id = id;
    input.multiple = true;
    // Off screen but rendered: Playwright needs to be able to reach it.
    input.style.cssText = 'position:fixed;left:-4000px;top:0;width:100px;height:20px;';
    document.body.appendChild(input);
  }, INJECTOR_ID);

  // This Playwright version wants `{ name, mimeType, buffer }` together, so a
  // file with an overridden type is read into memory first.
  const payload = files.map((file) => {
    if (typeof file === 'string') return file;
    return {
      name: path.basename(file.path),
      mimeType: file.mimeType,
      buffer: fs.readFileSync(file.path),
    };
  });
  await page.setInputFiles(`#${INJECTOR_ID}`, payload);

  await page.evaluate(
    ({ id, x, y }) => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      const dataTransfer = new DataTransfer();
      for (const file of input?.files ?? []) dataTransfer.items.add(file);
      const target = document.querySelector('[data-testid="board"]') ?? document.body;
      target.dispatchEvent(
        new DragEvent('dragenter', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer,
        }),
      );
      target.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer,
        }),
      );
      target.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer,
        }),
      );
      if (input) input.value = '';
    },
    { id: INJECTOR_ID, x: at.x, y: at.y },
  );
}

/** Every image object currently rendered, ordered left to right. */
export async function imageBoxes(page: Page): Promise<ImageBox[]> {
  const boxes: ImageBox[] = await page.locator('[data-image-id]').evaluateAll((els) =>
    els.map((el) => {
      const rect = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-image-id') ?? '',
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        status: el.getAttribute('data-image-status') ?? '',
      };
    }),
  );
  // Yjs map iteration order is not insertion order, so sort for stable layout
  // assertions.
  return boxes.sort((a, b) => a.x - b.x || a.y - b.y);
}

/** How many images are rendered *and* actually decoded by the browser. */
export async function loadedImages(page: Page): Promise<number> {
  return page
    .locator('[data-testid="image-content"]')
    .evaluateAll((els) => els.filter((el) => el.complete && el.naturalWidth > 0).length);
}

/** Drag the bottom-right resize handle of the currently selected object. */
export async function dragCorner(
  page: Page,
  handle: 'se' | 'ne' | 'nw' | 'sw',
  dx: number,
  dy: number,
): Promise<void> {
  const locator = page.locator(`[data-resize-handle="${handle}"]`);
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`resize handle ${handle} is not visible`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(60);
}
