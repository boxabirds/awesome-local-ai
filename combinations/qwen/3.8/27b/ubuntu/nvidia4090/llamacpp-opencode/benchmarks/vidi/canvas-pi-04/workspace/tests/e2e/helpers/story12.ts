// Story 12 e2e helpers (TC-25..TC-28).
//
// Images are dropped through a real HTML5 drop event (Playwright has no
// file-drag API, so a DataTransfer carrying real File objects is dispatched on
// `.app-root`) or picked through the hidden file input. Fixtures are small,
// magic-byte-valid PNG/JPEG files under tests/fixtures, read from disk.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { expect, type Page } from '@playwright/test';

export const VIEWPORT = '[data-testid="board-viewport"]';
export const IMAGE = '[data-testid="image-object"]';
export const IMAGE_READY = '[data-testid="image-img"]';
export const IMAGE_PROGRESS = '[data-testid="image-progress-text"]';
export const IMAGE_UNAVAILABLE = '[data-testid="image-unavailable"]';
export const IMAGE_FAILED = '[data-testid="image-failed"]';
export const IMAGE_RETRY = '[data-testid="image-retry"]';
export const IMAGE_REMOVE = '[data-testid="image-remove"]';
export const IMAGE_UNFINISHED = '[data-testid="image-unfinished"]';
export const TOAST = '[data-testid="toast"]';
export const PICKER_INPUT = '.image-picker-input';

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../fixtures');

export interface ImageFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

function fixture(name: string, mimeType: string): ImageFile {
  return { name, mimeType, buffer: readFileSync(join(FIXTURE_DIR, name)) };
}

export const RED_PNG = fixture('img-red.png', 'image/png');
export const BLUE_PNG = fixture('img-blue.png', 'image/png');
export const GREEN_PNG = fixture('img-green.png', 'image/png');
export const ORANGE_JPG = fixture('img-orange.jpg', 'image/jpeg');
export const DOC_PDF = fixture('doc.pdf', 'application/pdf');

/** A file over the 10 MB cap (content is irrelevant; size is what rejects). */
export function oversizedFile(): ImageFile {
  return { name: 'big.png', mimeType: 'image/png', buffer: Buffer.alloc(11 * 1024 * 1024, 0x89) };
}

async function viewportCenter(page: Page): Promise<{ x: number; y: number }> {
  const box = (await page.locator(VIEWPORT).boundingBox()) ?? { x: 0, y: 0, width: 1280, height: 800 };
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Dispatch a real HTML5 drop of the given files at the viewport centre. */
export async function dropFilesAtCenter(page: Page, files: ImageFile[]): Promise<void> {
  const { x, y } = await viewportCenter(page);
  await page.evaluate(
    ({ files, clientX, clientY }) => {
      const root = document.querySelector('.app-root');
      if (root === null) throw new Error('.app-root not found');
      const dt = new DataTransfer();
      for (const f of files) {
        const u8 = new Uint8Array(f.bytes);
        dt.items.add(new File([u8], f.name, { type: f.mimeType }));
      }
      const drop = new Event('drop', { bubbles: true, cancelable: true });
      Object.assign(drop, { dataTransfer: dt, clientX, clientY });
      root.dispatchEvent(drop);
    },
    {
      files: files.map((f) => ({ name: f.name, mimeType: f.mimeType, bytes: Array.from(f.buffer) })),
      clientX: x,
      clientY: y,
    },
  );
}

/** Provide files to the hidden picker input (fires the change handler). */
export async function pickFiles(page: Page, files: ImageFile[]): Promise<void> {
  await page.locator(PICKER_INPUT).setInputFiles(
    files.map((f) => ({ name: f.name, mimeType: f.mimeType, buffer: f.buffer })),
  );
}

/** Wait until `count` image objects are on the board. */
export async function expectImages(page: Page, count: number, timeout = 15_000): Promise<void> {
  await expect(page.locator(IMAGE)).toHaveCount(count, { timeout });
}

/** Wait for every image to reach a given data-status (e.g. "ready"). */
export async function expectAllStatus(page: Page, status: string, timeout = 15_000): Promise<void> {
  await expect
    .poll(
      async () => {
        const els = await page.locator(IMAGE).all();
        if (els.length === 0) return false;
        const statuses = await Promise.all(els.map((el) => el.getAttribute('data-status')));
        return statuses.every((s) => s === status);
      },
      { timeout },
    )
    .toBe(true);
}

/** The (width, height) of the first image's inline style, in CSS px. */
export async function firstImageBox(page: Page): Promise<{ width: number; height: number }> {
  const el = page.locator(IMAGE).first();
  const box = (await el.boundingBox()) ?? { width: 0, height: 0 };
  return { width: box.width, height: box.height };
}

/** Press the selection's "Resize <handle>" and drag it by a world delta. */
export async function dragImageHandle(page: Page, handle: string, dx: number, dy: number, zoom: number): Promise<void> {
  const handleEl = page.locator(`[aria-label="Resize ${handle}"]`);
  const box = (await handleEl.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx * zoom, cy + dy * zoom, { steps: 16 });
  await page.mouse.up();
}

/** Click the centre of the first image to select it (shows the handles). */
export async function selectFirstImage(page: Page): Promise<void> {
  const el = page.locator(IMAGE).first();
  const box = (await el.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}
