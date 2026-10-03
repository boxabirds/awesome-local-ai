/**
 * Pictures, in a real browser.
 *
 * Three things here exist because a real browser is fussy about them in ways jsdom is not:
 *
 * - **Dropping files.** There is no operating system to drag from, so the drag is built out of
 *   the same objects the browser builds: a `DataTransfer` with real `File`s in it, dispatched as
 *   `dragover` and then `drop` on the viewport. Chromium, Firefox and WebKit all let a page do
 *   this, and it is the only way to test a drop that is a drop rather than a function call.
 * - **Choosing files.** A file dialog is not part of the page, so Playwright intercepts it and
 *   answers it (`filechooser`), which is also how a test hands over a file that would be absurd
 *   to keep in a repository — an eleven-megabyte one, say.
 * - **Knowing a picture arrived.** `naturalWidth` is the browser's own verdict that the bytes
 *   decoded into an image. A `<img>` with a src that 404s has `naturalWidth` 0, and no amount of
 *   text on screen says that.
 */
import { expect, type Page } from '@playwright/test';

import { IMAGE_MAX_BYTES } from '../../../src/shared/config';
import { fixtureBytes, fixtureMime } from '../../fixtures/image-files';
import type { ScreenPoint } from './participants';

export const IMAGE_SELECTOR = '[data-testid="image-object"]';
export const PICTURE_SELECTOR = '[data-testid="image-picture"]';
export const DROP_HIGHLIGHT = '[data-testid="drop-highlight"]';
export const TOAST_SELECTOR = '[data-testid="toast"]';
export const RETRY_BUTTON = '[data-testid="image-retry"]';
export const REMOVE_BUTTON = '[data-testid="image-remove"]';

/** What Playwright needs to hand a file to a browser without a path on disk. */
export interface FilePayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** One fixture file, as a file a browser can be given. `as` renames it. */
export function fixturePayload(name: string, as?: string): FilePayload {
  return {
    name: as ?? name,
    mimeType: as ? 'application/octet-stream' : fixtureMime(name),
    buffer: Buffer.from(fixtureBytes(name)),
  };
}

/** A file whose declared type is not one of the four, whatever its bytes are. */
export function wrongTypePayload(name = 'diagram.pdf'): FilePayload {
  const payload = fixturePayload('renamed-pdf.png', name);
  return { ...payload, mimeType: 'application/pdf' };
}

/**
 * A valid JPEG one byte over the board's limit.
 *
 * Built rather than stored: everything after a JPEG's end-of-image marker is ignored by every
 * decoder, so the padding changes the size and nothing else — and an eleven-megabyte fixture in
 * a repository would be a worse story than this comment.
 */
export function oversizedJpegPayload(): FilePayload {
  const jpeg = fixtureBytes('photo-small.jpg');
  const buffer = Buffer.alloc(IMAGE_MAX_BYTES + 1);
  Buffer.from(jpeg).copy(buffer);
  return { name: 'huge.jpg', mimeType: 'image/jpeg', buffer };
}

/** Send the bytes of a payload to the page as base64, and rebuild them there. */
async function dispatchFiles(
  page: Page,
  events: readonly ('dragover' | 'drop')[],
  files: readonly FilePayload[],
  at: ScreenPoint,
): Promise<void> {
  await page.evaluate(
    ({ events, files, at }) => {
      const transfer = new DataTransfer();
      for (const file of files) {
        const bytes = Uint8Array.from(atob(file.buffer), (character) =>
          character.charCodeAt(0),
        );
        transfer.items.add(new File([bytes], file.name, { type: file.mimeType }));
      }
      const viewport = document.querySelector('[data-testid="board-viewport"]');
      if (!viewport) throw new Error('there is no board to drop onto');
      for (const name of events) {
        viewport.dispatchEvent(
          new DragEvent(name, {
            bubbles: true,
            cancelable: true,
            clientX: at.x,
            clientY: at.y,
            dataTransfer: transfer,
          }),
        );
      }
    },
    { events, files: files.map((file) => ({ ...file, buffer: file.buffer.toString('base64') })), at },
  );
}

/** Files hovering over the board: the drag has begun and not yet let go. */
export async function dragFilesOver(
  page: Page,
  files: readonly FilePayload[],
  at: ScreenPoint = { x: 640, y: 400 },
): Promise<void> {
  await dispatchFiles(page, ['dragover'], files, at);
}

/** Let go: the files land at `at`. */
export async function dropFiles(
  page: Page,
  files: readonly FilePayload[],
  at: ScreenPoint = { x: 640, y: 400 },
): Promise<void> {
  await dispatchFiles(page, ['dragover', 'drop'], files, at);
}

/**
 * Answer the file dialog that `open` opens.
 *
 * `open` is the thing a person does — press `I`, or click the toolbar's Image button — and the
 * dialog it raises is intercepted rather than filled in.
 */
export async function chooseFiles(
  page: Page,
  open: () => Promise<void>,
  files: readonly FilePayload[],
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await open();
  const dialog = await chooser;
  await dialog.setFiles([...files]);
}

/** One image as this screen paints it. */
export interface ImageOnScreen {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The document's status: `uploading`, `ready` or `failed`. */
  status: string;
  /** Whose upload it was, which decides whether Retry appears. */
  uploader: string;
  /** The stored key, or empty while there is none. */
  key: string;
}

/** Every image on this screen, in the order they are painted. */
export async function readImages(page: Page): Promise<ImageOnScreen[]> {
  return page.$$eval(IMAGE_SELECTOR, (elements) =>
    elements.map((element) => {
      const object = element as HTMLElement;
      return {
        id: object.dataset.objectId ?? '',
        x: Number.parseFloat(object.style.left),
        y: Number.parseFloat(object.style.top),
        width: Number.parseFloat(object.style.width),
        height: Number.parseFloat(object.style.height),
        status: object.dataset.imageStatus ?? '',
        uploader: object.dataset.imageUploader ?? '',
        key: object.dataset.imageKey ?? '',
      };
    }),
  );
}

export async function imageCount(page: Page): Promise<number> {
  return page.locator(IMAGE_SELECTOR).count();
}


/**
 * The picture inside an image, as the browser decoded it.
 *
 * `naturalWidth` is the whole assertion: a `<img>` whose bytes did not arrive, or did not
 * decode, reports 0 however tidy its `src` looks.
 */
export async function decodedSize(
  page: Page,
  id: string,
): Promise<{ width: number; height: number } | null> {
  return page.evaluate(
    ({ objectSelector, pictureSelector }) => {
      const object = document.querySelector(objectSelector);
      const picture = object?.querySelector(pictureSelector) as HTMLImageElement | null;
      if (!picture) return null;
      return { width: picture.naturalWidth, height: picture.naturalHeight };
    },
    { objectSelector: `${IMAGE_SELECTOR}[data-object-id="${id}"]`, pictureSelector: PICTURE_SELECTOR },
  );
}

/** The text of every toast on screen, newest included. */
export async function toastMessages(page: Page): Promise<string[]> {
  const messages = page.locator(`${TOAST_SELECTOR} .toast__message`);
  const count = await messages.count();
  const texts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    texts.push((await messages.nth(index).textContent()) ?? '');
  }
  return texts;
}

/** Wait until the toasts say all of these things, in any order. */
export async function waitForToasts(page: Page, expected: readonly string[]): Promise<void> {
  await expect
    .poll(() => toastMessages(page).then((texts) => expected.every((one) => texts.includes(one))), {
      message: `the board never said: ${expected.join(' / ')}`,
      timeout: 15_000,
    })
    .toBe(true);
}

/** The words inside one image, for the states that are only words. */
export async function imageText(page: Page, id: string): Promise<string> {
  const text = await page
    .locator(`${IMAGE_SELECTOR}[data-object-id="${id}"]`)
    .innerText()
    .catch(() => '');
  return text.replace(/\s+/g, ' ').trim();
}

/** Keep an image's uploads slow enough to look at. Returns how to undo it. */
export async function delayUploads(page: Page, ms: number): Promise<() => Promise<void>> {
  await page.route('**/api/boards/*/assets', async (route) => {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
    await route.continue();
  });
  return () => page.unroute('**/api/boards/*/assets');
}

/** Refuse every upload, the way a network that is down does. */
export async function blockUploads(page: Page): Promise<() => Promise<void>> {
  await page.route('**/api/boards/*/assets', (route) => {
    void route.abort();
  });
  return () => page.unroute('**/api/boards/*/assets');
}

/** The headers of every asset this page has fetched, newest last. */
export interface AssetResponse {
  url: string;
  status: number;
  cacheControl: string;
  contentType: string;
  nosniff: string;
  contentSecurityPolicy: string;
}

/** Watch this page's asset requests. Returns the log to read afterwards. */
export function watchAssetRequests(page: Page): AssetResponse[] {
  const seen: AssetResponse[] = [];
  page.on('response', (response) => {
    if (!response.url().includes('/api/assets/')) return;
    const headers = response.headers();
    seen.push({
      url: response.url(),
      status: response.status(),
      cacheControl: headers['cache-control'] ?? '',
      contentType: headers['content-type'] ?? '',
      nosniff: headers['x-content-type-options'] ?? '',
      contentSecurityPolicy: headers['content-security-policy'] ?? '',
    });
  });
  return seen;
}
