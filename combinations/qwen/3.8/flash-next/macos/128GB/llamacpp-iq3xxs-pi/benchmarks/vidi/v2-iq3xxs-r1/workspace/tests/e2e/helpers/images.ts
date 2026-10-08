import { expect, type Page } from '@playwright/test';
import { fixtureBytes, paddedJpeg, type ImageFixture } from '../../fixtures/images';
import type { DisplayStatus, ImageSnap } from '../../../src/shared/objects/image';
import { IMAGE_MAX_BYTES } from '../../../src/shared/config';
import type { Box } from './board';
import { worldToScreen } from './shapes';

/**
 * Driving the three doors in a real browser (story 12).
 *
 * A drop has to arrive as a real `DataTransfer` full of real `File`s, because that is
 * the only thing the board's handlers read — so the fixture bytes are carried into the
 * page and reassembled there, and the drop is dispatched at the viewport the person
 * would have dropped on. A picker is driven the way a person drives it: the button is
 * clicked, and the file dialog Playwright is told about is answered with the same bytes.
 */

/** A file, as it is carried between this node process and a page. */
export interface ImagePayload {
  name: string;
  mimeType: string;
  base64: string;
}

const MIME: Record<ImageFixture, string> = {
  'photo.png': 'image/png',
  'screenshot.png': 'image/png',
  'photo.jpg': 'image/jpeg',
  'photo.webp': 'image/webp',
  'animated.gif': 'image/gif',
  'corrupt.png': 'image/png',
  'document.pdf': 'application/pdf',
  'fake.png': 'image/png',
  'script.svg': 'image/svg+xml',
};

/** A fixture, as a file a page can be handed. */
export async function imagePayload(name: ImageFixture): Promise<ImagePayload> {
  return payload(name, MIME[name], await fixtureBytes(name));
}

export function payload(name: string, mimeType: string, bytes: Uint8Array): ImagePayload {
  return { name, mimeType, base64: Buffer.from(bytes).toString('base64') };
}

export async function imagePayloads(...names: ImageFixture[]): Promise<ImagePayload[]> {
  return Promise.all(names.map((name) => imagePayload(name)));
}

/**
 * A JPEG one byte past the size the server will accept: the base photo with JPEG
 * comment segments added, so it is a picture that is too big rather than a blob that
 * merely has the wrong length.
 */
export async function oversizeJpegPayload(name = 'too-big.jpg'): Promise<ImagePayload> {
  const bytes = paddedJpeg(await fixtureBytes('photo.jpg'), IMAGE_MAX_BYTES + 1);
  return payload(name, 'image/jpeg', bytes);
}

const VIEWPORT = '[data-testid="board-viewport"]';

/**
 * Drop files on the board at a screen point. The `DataTransfer` is built in the page
 * from the same bytes the unit and integration tests use, so the board is answering a
 * `drop` event with real files in it, at a real position.
 */
export async function dropImages(
  page: Page,
  files: readonly ImagePayload[],
  at?: { x: number; y: number },
): Promise<void> {
  const point = at ?? (await viewportCentre(page));
  const dataTransfer = await page.evaluateHandle(async ({ files }) => {
    const transfer = new DataTransfer();
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: file.mimeType }));
    }
    return transfer;
  }, { files: [...files] });

  const target = page.locator(VIEWPORT);
  // enter, then over, then released — the board counts entries to decide what to show,
  // and answers `drop` where the person let go.
  await target.dispatchEvent('dragenter', { dataTransfer, clientX: point.x, clientY: point.y });
  await target.dispatchEvent('dragover', { dataTransfer, clientX: point.x, clientY: point.y });
  await target.dispatchEvent('drop', { dataTransfer, clientX: point.x, clientY: point.y });
}

/**
 * Drop files at a *world* point, so a test can say where on the board they landed rather
 * than where the mouse happened to be.
 */
export async function dropImagesAtWorld(
  page: Page,
  files: readonly ImagePayload[],
  at: { x: number; y: number },
): Promise<void> {
  const screen = await worldToScreen(page, at);
  await dropImages(page, files, { x: screen.x, y: screen.y });
}

/**
 * Hand the board a paste event carrying image files. Only the Chromium half of the
 * clipboard is available here (design "Not covered"), and it is driven as a clipboard
 * event rather than by trusting the OS clipboard, so the byte-for-byte path from a
 * pasted picture to a placeholder is the same one a real Cmd+V takes.
 */
export async function pasteImages(page: Page, files: readonly ImagePayload[]): Promise<void> {
  await page.evaluate(async ({ files }) => {
    const transfer = new DataTransfer();
    for (const file of files) {
      const bytes = Uint8Array.from(atob(file.base64), (character) => character.charCodeAt(0));
      transfer.items.add(new File([bytes], file.name, { type: file.mimeType }));
    }
    window.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  }, { files: [...files] });
}

/**
 * Open the picker with the Image button (or the `I` key) and answer the file dialog it
 * raises. Playwright sees the dialog the app's `<input type="file">` opened, so the
 * answer goes through the same channel a person's choice would.
 */
export async function pickImages(
  page: Page,
  files: readonly ImagePayload[],
  { via = 'button' }: { via?: 'button' | 'key' } = {},
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  if (via === 'key') {
    await page.keyboard.press('i');
  } else {
    await page.getByTestId('tool-image').click();
  }
  const dialog = await chooser;
  await dialog.setFiles(
    (await Promise.all(files)).map((file) => ({
      name: file.name,
      mimeType: file.mimeType,
      buffer: Buffer.from(file.base64, 'base64'),
    })),
  );
}

// --- What the screen and the document show -----------------------------------

/** The image objects this screen's document holds. */
export function imageSnaps(page: Page): Promise<readonly ImageSnap[]> {
  return page.evaluate(() => window.__vidi6!.getImages());
}

/** Upload progress this tab is seeing (only the sending tab has any). */
export function uploadProgress(page: Page): Promise<{ id: string; fraction: number }[]> {
  return page.evaluate(() => window.__vidi6!.uploadProgress());
}

/** Wait until this screen's document holds `count` image objects. */
export async function waitForImages(page: Page, count: number): Promise<readonly ImageSnap[]> {
  await expect
    .poll(async () => (await imageSnaps(page)).length, { timeout: IMAGE_TIMEOUT_MS })
    .toBe(count);
  return imageSnaps(page);
}

/** Wait until `count` of this screen's images are in one display status. */
export async function waitForDisplayStatus(
  page: Page,
  status: DisplayStatus,
  count = 1,
): Promise<readonly ImageSnap[]> {
  await expect
    .poll(async () => (await imageSnaps(page)).filter((image) => image.status === status).length, {
      timeout: IMAGE_TIMEOUT_MS,
    })
    .toBe(count);
  return (await imageSnaps(page)).filter((image) => image.status === status);
}

/** The status text of every image box on this screen, in document order. */
export function statusTexts(page: Page): Promise<string[]> {
  return page.locator('[data-testid="image-status"]').allTextContents();
}

/** Toast sentences the screen is showing. */
export async function toastTexts(page: Page): Promise<string[]> {
  const stack = page.getByTestId('toast-stack');
  if ((await stack.count()) === 0) return [];
  return stack.getByTestId('toast').allTextContents();
}

/** The screen box of one image, by document id. */
export async function imageBox(page: Page, id: string): Promise<Box & { width: number; height: number }> {
  const box = await page.locator(`[data-image-id="${id}"]`).boundingBox();
  if (!box) throw new Error(`image ${id} has no box on screen`);
  return box;
}

/**
 * The pictures on this screen that the browser has *finished loading* — decoded, with
 * their natural size. A `src` that is merely set would not count: this is how a test
 * knows the bytes came out of storage.
 */
export async function loadedPictures(page: Page): Promise<
  { id: string; naturalWidth: number; naturalHeight: number; complete: boolean }[]
> {
  return page.evaluate(() => {
    const out: { id: string; naturalWidth: number; naturalHeight: number; complete: boolean }[] = [];
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>(
      '[data-image-id] [data-testid="image-picture"]',
    ))) {
      out.push({
        id: img.closest<HTMLElement>('[data-image-id]')?.dataset.imageId ?? '',
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        complete: img.complete,
      });
    }
    return out;
  });
}

/** Wait until `count` pictures have been decoded by this screen. */
export async function waitForLoadedPictures(page: Page, count: number): Promise<void> {
  await expect
    .poll(async () => (await loadedPictures(page)).filter((p) => p.complete && p.naturalWidth > 0).length, {
      timeout: IMAGE_TIMEOUT_MS,
    })
    .toBe(count);
}

/**
 * The upload endpoint. Pictures are *served* from `/api/assets/...` but *sent* to
 * `/api/boards/:id/assets`, and it is the sending that a test wants to be slow or
 * broken; serving is left alone, so a picture that is supposed to load still loads.
 */
const UPLOAD_ROUTE = '**/api/boards/*/assets';

/**
 * Keep every upload pending for `delay` ms before letting it go, so the states between
 * "dropped" and "stored" are around long enough to be seen from another screen. The
 * request still reaches the real storage afterwards.
 */
export async function slowUploads(page: Page, delay: number): Promise<void> {
  await page.route(UPLOAD_ROUTE, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fallback();
  });
}

/** Make every upload this page attempts fail as though the network refused. */
export async function breakUploads(page: Page): Promise<void> {
  await page.route(UPLOAD_ROUTE, (route) =>
    route.request().method() === 'POST' ? route.abort() : route.fallback(),
  );
}

/** Undo `breakUploads`. */
export async function fixUploads(page: Page): Promise<void> {
  await page.unroute(UPLOAD_ROUTE);
}

/** Scroll-free centre of the viewport, for a drop with nowhere in particular. */
export async function viewportCentre(page: Page): Promise<Box> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="board-viewport"]');
    const rect = el?.getBoundingClientRect();
    if (!rect) throw new Error('no viewport to drop on');
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
}

/**
 * An image drop and its wait, for the many tests that only need one stored picture:
 * returns the object as the document describes it once it is `ready`.
 */
export async function dropOneImage(
  page: Page,
  name: ImageFixture = 'photo.png',
  at?: { x: number; y: number },
): Promise<ImageSnap> {
  await dropImages(page, await imagePayloads(name), at);
  const [image] = await waitForImages(page, 1);
  await waitForLoadedPictures(page, 1);
  return image!;
}

/** A drop of an image that lands in the middle of what the screen shows. */
export async function dropOneImageInCentre(page: Page, name: ImageFixture = 'photo.png'): Promise<ImageSnap> {
  return dropOneImage(page, name, await viewportCentre(page));
}

/** An image upload that has to be waited for is not slow, it is a network. */
const IMAGE_TIMEOUT_MS = 30_000;
