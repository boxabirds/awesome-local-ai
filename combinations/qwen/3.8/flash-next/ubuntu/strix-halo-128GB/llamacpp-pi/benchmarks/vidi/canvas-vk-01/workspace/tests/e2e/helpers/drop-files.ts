import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type Locator, type Page } from '@playwright/test';

/**
 * Getting image files onto the board from Playwright (`image.drop`, `image.pick`).
 *
 * A file drag is not something a driver can fake with the mouse: the browser only
 * hands a page the files of a drag through a `DataTransfer` it created itself. So
 * this builds one inside the page from real bytes — the fixture files, unchanged —
 * and dispatches the same three events a real drag dispatches, in the order it
 * does. The board cannot tell the difference, which is the point.
 */

const FIXTURES = fileURLToPath(new URL('../../fixtures/images', import.meta.url));

/** A file as the page receives it: bytes in, `File` out. */
export interface PageFile {
  name: string;
  type: string;
  /** Base64 of the bytes; how they cross into the page. */
  base64: string;
}

export interface DroppedFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

/** A committed fixture, with the type the browser would report for it. */
export function fixtureFile(fileName: string, type = mimeTypeFor(fileName)): DroppedFile {
  return { name: fileName, type, bytes: new Uint8Array(readFileSync(join(FIXTURES, fileName))) };
}

/** A file of a given size, for the limits that are about size and not content. */
export function sizedFile(name: string, type: string, bytes: number): DroppedFile {
  return { name, type, bytes: new Uint8Array(bytes) };
}

/** The `accept`-style type a browser infers from these extensions. */
export function mimeTypeFor(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  switch (extension) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'webp':
      return 'image/webp';
    case 'svg':
      return 'image/svg+xml';
    case 'pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

const asPageFile = (file: DroppedFile): PageFile => ({
  name: file.name,
  type: file.type,
  base64: Buffer.from(file.bytes).toString('base64'),
});

/** The board area files are dropped on. */
export const boardArea = (page: Page): Locator => page.getByTestId('board-viewport');

/**
 * Drop files so that the top-left of the first image lands at `at` (`image.drop`).
 * `dragenter` and `dragover` come first because the board only accepts a drop once
 * it has answered those, exactly as it does for a person.
 */
export async function dropFilesOnBoard(
  page: Page,
  at: { x: number; y: number },
  files: readonly DroppedFile[],
): Promise<void> {
  await page.evaluate(
    async ({ x, y, payload }) => {
      const dataTransfer = new DataTransfer();
      for (const entry of payload) {
        const raw = Uint8Array.from(atob(entry.base64), (character) => character.charCodeAt(0));
        dataTransfer.items.add(new File([raw], entry.name, { type: entry.type }));
      }
      const target = document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
      if (target === null) throw new Error('the board is not on screen');
      for (const type of ['dragenter', 'dragover', 'drop'] as const) {
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer,
          }),
        );
        // Let the board react to each step, as it would between real moves.
        await new Promise((resolveStep) => setTimeout(resolveStep, 0));
      }
    },
    { x: at.x, y: at.y, payload: files.map(asPageFile) },
  );
}

/**
 * Press `I` and answer the file picker (`image.pick`, `image.types`,
 * `image.size_limit`). The picker itself is the browser's, so the test listens for
 * it rather than clicking the hidden input.
 */
export async function chooseFilesWithPicker(
  page: Page,
  files: ReadonlyArray<{ name: string; type?: string; bytes: Uint8Array | Buffer }>,
  key = 'i',
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press(key);
  const picked = await chooser;
  await picked.setFiles(
    files.map((file) => ({
      name: file.name,
      mimeType: file.type ?? mimeTypeFor(file.name),
      buffer: Buffer.from(file.bytes),
    })),
  );
}

/** Every image the page shows, by the id every client shares. */
export async function imageIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="image-object-"]')].map((element) =>
      String(element.getAttribute('data-testid')).replace('image-object-', ''),
    ),
  );
}

export const imageObjects = (page: Page): Locator =>
  page.locator('[data-testid^="image-object-"]');

export const imageObject = (page: Page, id: string): Locator =>
  page.locator(`[data-testid="image-object-${id}"]`);

/** The state the object is drawing: `uploading`, `ready`, `failed`, `unfinished`. */
export async function imageStatus(page: Page, id: string): Promise<string | null> {
  return imageObject(page, id).getAttribute('data-status');
}

/** The uploaded size on screen, in CSS pixels. */
export async function imageBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await imageObject(page, id).boundingBox();
  if (box === null) throw new Error(`image ${id} is not on ${page.url()}`);
  return box;
}

/** True once the browser has the picture: decoded, not merely requested. */
export async function imageDecoded(page: Page, id: string): Promise<boolean> {
  return page.evaluate((testId) => {
    const element = document.querySelector<HTMLImageElement>(`[data-testid="${testId}"]`);
    return element !== null && element.complete && element.naturalWidth > 0;
  }, `image-object-${id}`);
}

/** The refusals currently on screen, in the order they were put there. */
export async function toastTexts(page: Page): Promise<string[]> {
  return page.getByTestId('toast').allTextContents();
}

/**
 * Delay every asset upload by `ms` before letting it go. An upload to local R2
 * finishes in milliseconds, which is faster than a test can look; this makes the
 * uploading state something a second client can actually be shown.
 */
export async function holdUploads(page: Page, ms: number): Promise<void> {
  await page.route('**/api/boards/*/assets', async (route) => {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
    await route.fallback();
  });
}

/** Make every asset upload fail, the way a dead network does (`image.upload_failure`). */
export async function breakUploads(page: Page): Promise<void> {
  await page.route('**/api/boards/*/assets', (route) => route.abort());
}

export async function letUploadsThrough(page: Page): Promise<void> {
  await page.unroute('**/api/boards/*/assets');
}

/** Every `/api/assets/...` response the page has seen, headers and all. */
export interface AssetResponse {
  url: string;
  status: number;
  cacheControl: string | null;
  contentType: string | null;
  nosniff: string | null;
  csp: string | null;
}

export function watchAssetResponses(page: Page): { responses(): AssetResponse[] } {
  const responses: AssetResponse[] = [];
  page.on('response', (response) => {
    if (!response.url().includes('/api/assets/')) return;
    const headers = response.headers();
    responses.push({
      url: response.url(),
      status: response.status(),
      cacheControl: headers['cache-control'] ?? null,
      contentType: headers['content-type'] ?? null,
      nosniff: headers['x-content-type-options'] ?? null,
      csp: headers['content-security-policy'] ?? null,
    });
  });
  return { responses: () => [...responses] };
}
