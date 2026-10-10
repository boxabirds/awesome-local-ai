/**
 * Story 12: getting real files onto a real board in a real browser, and reading the pictures
 * back.
 *
 * A person drags files from their own machine, and no browser will let a test do that — the
 * files a page is handed come from the page's own origin. So the drop is built the way the
 * browser would build it: a `DataTransfer` carrying `File`s, dropped on the viewport at the
 * point the test names. The fixture bytes come from `tests/fixtures/images/`, so these are the
 * same PNG and JPEG bytes the unit, integration and component tests agree about.
 *
 * Reading images back is done twice over on purpose: the document says what the board believes
 * (`status`, `assetKey`), and the `<img>` says what a viewer actually has in front of them
 * (`naturalWidth > 0`), and the story is about the two of them agreeing.
 */
import { expect, type FileChooser, type Locator, type Page } from '@playwright/test';
import { bytesOf, type ImageFixture } from '../../fixtures/image-files';
import { connectionState } from './participants';
import { IMAGE_MAX_BYTES } from '../../../src/shared/config';
import { jpegSized } from '../../fixtures/image-bytes';

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One file to put on a board: a name, the type its name claims, and its bytes. */
export interface DroppedFile {
  readonly name: string;
  readonly mime: string;
  /** A view over a plain buffer, which is what `File` will accept and `File`'s type demands. */
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/** A fixture file, ready to be dropped. */
export function dropFixture(fixture: ImageFixture, name: string = fixture): DroppedFile {
  return { name, mime: mimeOf(name), bytes: bytesOf(fixture) };
}

/** A file over the size an upload may be, made of nothing but a JPEG header and filler. */
export function oversizedJpeg(name = 'huge.jpg'): DroppedFile {
  // Copied, because `jpegSized` hands out a view the type system cannot promise is not a
  // `SharedArrayBuffer`, and a `File` is not prepared to be asked.
  return { name, mime: 'image/jpeg', bytes: new Uint8Array(jpegSized(IMAGE_MAX_BYTES + 1)) };
}

function mimeOf(name: string): string {
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.jpg')) return 'image/jpeg';
  if (name.endsWith('.gif')) return 'image/gif';
  if (name.endsWith('.webp')) return 'image/webp';
  throw new Error(`no MIME type for ${name}`);
}

/* ---------------------------------------------------------------- the drop */

/**
 * Drag these files onto the board and let go at `at`, in viewport-relative CSS pixels.
 *
 * `dragenter` and `dragover` come first because the browser (and this board) only lets go once
 * somebody has said they will catch: `dragover` is where a drop is accepted. `dragenter` is
 * dispatched on the window because that is where the drop highlight listens for it — so a test
 * that wants the highlight can look for it before letting go.
 */
export async function carryImages(
  page: Page,
  files: readonly DroppedFile[],
  at: Point,
): Promise<void> {
  await waitForUploadable(page);
  await page.evaluate(
    ({ files, at }) => {
      const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
      if (!viewport) throw new Error('no viewport on the page');
      const transfer = new DataTransfer();
      for (const file of files) {
        transfer.items.add(new File([file.bytes], file.name, { type: file.mime }));
      }
      const box = viewport.getBoundingClientRect();
      const init: DragEventInit = {
        bubbles: true,
        cancelable: true,
        clientX: box.left + at.x,
        clientY: box.top + at.y,
        dataTransfer: transfer,
      };
      // The highlight listens on the window for the files coming in, the viewport for their
      // being over it: both are dispatched because both are what a hand moving the mouse does.
      window.dispatchEvent(new DragEvent('dragenter', { ...init, bubbles: false }));
      viewport.dispatchEvent(new DragEvent('dragover', init));
      // The bytes have to survive the trip back out of the page for the drop that follows.
      window.__vidi6CarriedFiles = transfer;
    },
    { files: [...files], at },
  );
}

/** The files the page was last asked to carry, if a test left them there. */
declare global {
  interface Window {
    __vidi6CarriedFiles?: DataTransfer;
  }
}

/**
 * Drop these files on the board at `at`, in viewport-relative CSS pixels: the full three-event
 * sequence a hand lets go of.
 */
export async function dropImages(page: Page, files: readonly DroppedFile[], at: Point): Promise<void> {
  await carryImages(page, files, at);
  await page.evaluate(({ at }) => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="viewport"]');
    const transfer = window.__vidi6CarriedFiles;
    if (!viewport || !transfer) throw new Error('no carried files to drop');
    const box = viewport.getBoundingClientRect();
    viewport.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: box.left + at.x,
        clientY: box.top + at.y,
        dataTransfer: transfer,
      }),
    );
    window.__vidi6CarriedFiles = undefined;
  }, { at });
}

/* ---------------------------------------------------------------- the picker */

/**
 * Press `I` and choose files in the dialog that opens — the only route to the picker that does
 * not depend on what the operating system draws around it.
 */
export async function pressImageTool(page: Page): Promise<void> {
  await page.keyboard.press('i');
}

/**
 * Wait until this board would accept a picture. An upload needs the server, so until the
 * connection is up a drop, a paste or a press of `I` is answered with a toast and nothing else
 * (`image.offline`) — and a test that pressed the key first would be waiting for a dialog that
 * the app correctly decided not to open.
 */
export async function waitForUploadable(page: Page): Promise<void> {
  await expect
    .poll(async () => connectionState(page), { timeout: 30_000 })
    .toMatch(/^(connected|confirmed)$/);
}

/**
 * Press `I` and hand the caller the file picker that opened, so a test can read what it offered
 * to accept and then choose files in it — which is the order a person does them in.
 */
export async function openImagePicker(page: Page): Promise<FileChooser> {
  await waitForUploadable(page);
  const chooser = page.waitForEvent('filechooser');
  await pressImageTool(page);
  return chooser;
}

/* ---------------------------------------------------------------- the upload */

/**
 * Sit between the board and the server on the way up, which is the only way to see a state that
 * lasts as long as an upload. The returned function takes the interceptor away again.
 */
export async function slowUploads(page: Page, milliseconds: number): Promise<void> {
  await page.route('**/api/boards/*/assets', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
    await route.continue();
  });
}

/** Make every upload fail, until the returned function is called. */
export async function failUploads(page: Page): Promise<() => Promise<void>> {
  await page.route('**/api/boards/*/assets', (route) => route.abort('failed'));
  return async () => {
    await page.unroute('**/api/boards/*/assets');
  };
}

/* ---------------------------------------------------------------- reading */

export interface ImageRecord {
  readonly id: string;
  readonly status: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly naturalWidth: number;
  readonly naturalHeight: number;
  readonly assetKey: string | null;
}

/** The image objects the board document holds. */
export async function boardImages(page: Page): Promise<ImageRecord[]> {
  const images = await page.evaluate(() => {
    const doc = window.__vidi6?.boardDoc?.();
    if (!doc) throw new Error('test hook window.__vidi6.boardDoc() is missing');
    const objects = doc.getMap('objects').toJSON() as Record<string, Record<string, unknown>>;
    return Object.entries(objects)
      .filter(([, value]) => value.type === 'image')
      .map(([id, value]) => ({
        id,
        status: String(value.status),
        x: Number(value.x),
        y: Number(value.y),
        width: Number(value.width),
        height: Number(value.height),
        naturalWidth: Number(value.naturalWidth),
        naturalHeight: Number(value.naturalHeight),
        assetKey: typeof value.assetKey === 'string' ? value.assetKey : null,
        uploaderId: typeof value.uploaderId === 'string' ? value.uploaderId : '',
      }));
  });
  return images.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function waitForImageCount(page: Page, count: number): Promise<ImageRecord[]> {
  await expect
    .poll(async () => (await boardImages(page)).length, { timeout: 15_000 })
    .toBe(count);
  return boardImages(page);
}

/** The picture itself, as drawn. */
export function picture(page: Page, id: string): Locator {
  return page.locator(`[data-note-id="${id}"][data-testid="image-object"]`);
}

/** The box an image that is not a picture is drawn in. */
export function imageBox(page: Page, id: string): Locator {
  return page.locator(`[data-note-id="${id}"][data-testid="image-state"]`);
}

export async function imageStatus(page: Page, id: string): Promise<string> {
  const drawn = await page.evaluate((imageId) => {
    const picture = document.querySelector(`[data-note-id="${imageId}"][data-testid="image-object"]`);
    if (picture) return 'ready';
    const box = document.querySelector<HTMLElement>(
      `[data-note-id="${imageId}"][data-testid="image-state"]`,
    );
    return box?.dataset.status ?? 'missing';
  }, id);
  return drawn;
}

export async function waitForImageStatus(page: Page, id: string, status: string): Promise<void> {
  await expect.poll(() => imageStatus(page, id), { timeout: 15_000 }).toBe(status);
}

/** Wait for every one of these images to be a picture the browser has actually loaded. */
export async function waitForPictures(page: Page, ids: readonly string[]): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((imageIds) => {
          return imageIds.every((imageId) => {
            const element = document.querySelector<HTMLImageElement>(
              `[data-note-id="${imageId}"][data-testid="image-object"]`,
            );
            return element !== null && element.complete && element.naturalWidth > 0;
          });
        }, ids),
      { timeout: 20_000 },
    )
    .toBe(true);
}

/** What an image is drawn as, on screen: its box in CSS pixels. */
export async function imageRect(page: Page, id: string): Promise<Rect> {
  const element = page.locator(`[data-note-id="${id}"]`);
  const box = await element.boundingBox();
  if (!box) throw new Error(`image ${id} has no bounding box (is it on screen?)`);
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

export async function clickImageAction(
  page: Page,
  id: string,
  action: 'image-retry' | 'image-remove',
): Promise<void> {
  await page.locator(`[data-note-id="${id}"] [data-testid="${action}"]`).click();
}

export async function imageActions(page: Page, id: string): Promise<string[]> {
  const ids = await page
    .locator(`[data-note-id="${id}"] [data-testid^="image-"]`)
    // `dataset.testId` is not a thing: HTML lowercases attribute names, so the only way to
    // read this one back is the attribute itself.
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-testid') ?? ''));
  return ids.filter((testId) => testId === 'image-retry' || testId === 'image-remove').sort();
}

export async function toastTexts(page: Page): Promise<string[]> {
  return page.locator('[data-testid="toast"]').allTextContents();
}

export async function waitForToast(page: Page, message: string): Promise<void> {
  await expect.poll(() => toastTexts(page), { timeout: 15_000 }).toContain(message);
}

/** The drop outline that appears while files are being carried over the board. */
export async function dropHighlightVisible(page: Page): Promise<boolean> {
  return (await page.locator('[data-testid="drop-highlight"]').count()) > 0;
}
