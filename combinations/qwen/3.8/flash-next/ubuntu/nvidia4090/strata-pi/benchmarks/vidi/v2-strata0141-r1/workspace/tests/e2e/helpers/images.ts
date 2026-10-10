import { expect, type FileChooser, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IMAGE_MAX_BYTES, E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import type { ImageSnap } from '../../../src/shared/objects/image';
import { jpegOfByteLength } from '../../fixtures/oversizeImage';
import { getCamera, VIEWPORT_HEIGHT, VIEWPORT_WIDTH, type ScreenPoint } from './board';

/**
 * Story 12 helpers: images handed to a real browser, and the board read back.
 *
 * Files reach the board the two ways a person brings them - a drop carrying a real
 * `DataTransfer` of real `File`s, and the file picker answered through Playwright's
 * file chooser - and the board is read two ways too: the document each page agreed
 * on, and the box the browser actually painted.
 */

const FIXTURES = fileURLToPath(new URL('../../fixtures/images/', import.meta.url));

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
};

/** A file a test hands to the browser: its name, the type it claims, its bytes. */
export interface TestFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

/** One of the committed fixture images (`tests/fixtures/images`). */
export function fixtureFile(name: string, options: { as?: string; type?: string } = {}): TestFile {
  const extension = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
  return {
    name: options.as ?? name,
    mimeType: options.type ?? MIME_BY_EXTENSION[extension] ?? 'application/octet-stream',
    bytes: new Uint8Array(readFileSync(`${FIXTURES}${name}`)),
  };
}

/** A PDF wearing an image name (`image.reject`, TC-26): only a sniff can refuse it. */
export function renamedPdf(): TestFile {
  const pdf = fixtureFile('not-an-image.png');
  return { name: 'report.png', mimeType: 'image/png', bytes: pdf.bytes };
}

/** A JPEG bigger than the limit, so only the size rule can refuse it (TC-26). */
export function oversizedImage(byteLength = IMAGE_MAX_BYTES + 1_000_000): TestFile {
  return { name: 'whole-board.jpg', mimeType: 'image/jpeg', bytes: jpegOfByteLength(byteLength) };
}

const base64Of = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

/** The screen position of a world point, under the page's current camera. */
export async function screenOfWorld(page: Page, world: ScreenPoint): Promise<ScreenPoint> {
  const camera = await getCamera(page);
  return { x: (world.x - camera.x) * camera.zoom, y: (world.y - camera.y) * camera.zoom };
}

/**
 * Drop files on the board at a world point (TC-25, TC-28).
 *
 * `DataTransfer` and `File` are the browser's own, built inside the page: the board
 * cannot tell this apart from a drag that came from the desktop, and it is the same
 * `drop` event a real one ends as.
 */
export async function dropFiles(page: Page, files: readonly TestFile[], at: ScreenPoint): Promise<void> {
  const screen = await screenOfWorld(page, at);
  const payload = files.map((file) => ({
    name: file.name,
    mimeType: file.mimeType,
    base64: base64Of(file.bytes),
  }));
  await page.evaluate(
    ({ entries, x, y }) => {
      const transfer = new DataTransfer();
      for (const entry of entries) {
        const text = atob(entry.base64);
        const bytes = new Uint8Array(text.length);
        for (let index = 0; index < text.length; index += 1) {
          bytes[index] = text.charCodeAt(index);
        }
        transfer.items.add(new File([bytes], entry.name, { type: entry.mimeType }));
      }
      const surface = document.querySelector('[data-board-surface="true"]') ?? document.body;
      for (const type of ['dragenter', 'dragover', 'drop']) {
        surface.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            clientX: x,
            clientY: y,
            dataTransfer: transfer,
          }),
        );
      }
    },
    { entries: payload, x: screen.x, y: screen.y },
  );
}

/** Open the picker the way a person does and answer it with these files (TC-26, TC-27). */
export async function pickFiles(
  page: Page,
  files: readonly TestFile[],
  how: 'key' | 'button' = 'key',
): Promise<void> {
  // The board answers a pick with a file dialog, so the toolbar being live is the
  // sign that a pick would be answered at all.
  await expect(page.getByTestId('image-tool')).toBeEnabled();

  // One waiter, kept alive while the opening is tried: registering and dropping a
  // file-chooser listener per attempt is its own chance to miss the dialog, and under
  // load a press can land while the page is busy. A person would press the key again.
  const chooserArrived = page.waitForEvent('filechooser', { timeout: 25_000 }).catch(() => null);
  let chooser: FileChooser | null = null;
  for (let attempt = 0; attempt < 3 && chooser === null; attempt += 1) {
    if (how === 'key') {
      await page.keyboard.press('i');
    } else {
      await page.getByTestId('image-tool').click();
    }
    chooser = await Promise.race([
      chooserArrived,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);
  }
  if (chooser === null) {
    await chooserArrived;
    throw new Error('the board never opened a file picker');
  }
  await chooser.setFiles(
    files.map((file) => ({ name: file.name, mimeType: file.mimeType, buffer: Buffer.from(file.bytes) })),
  );
}

/** Every image this page's document holds, topmost last. */
export async function imageSnapshots(page: Page): Promise<ImageSnap[]> {
  return page.evaluate(() => window.__vidi6?.images() ?? []);
}

export async function imageSnapshot(page: Page, id: string): Promise<ImageSnap | null> {
  const images = await imageSnapshots(page);
  return images.find((image) => image.id === id) ?? null;
}

/** Wait until the page's document holds `count` images, and hand them over. */
export async function waitForImageCount(page: Page, count: number): Promise<ImageSnap[]> {
  let latest: ImageSnap[] = [];
  await expect
    .poll(async () => {
      latest = await imageSnapshots(page);
      return latest.length;
    }, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `the board never held ${count} image${count === 1 ? '' : 's'}`,
    })
    .toBe(count);
  return latest;
}

/** Wait until this page's document holds exactly these image ids. */
export async function waitForImageIds(page: Page, ids: readonly string[]): Promise<ImageSnap[]> {
  const wanted = [...ids].sort().join(',');
  let latest: ImageSnap[] = [];
  await expect
    .poll(async () => {
      latest = await imageSnapshots(page);
      return latest.map((image) => image.id).sort().join(',');
    }, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `this board never held ${wanted}`,
    })
    .toBe(wanted);
  return latest;
}

/** Wait until this page's document says what `check` accepts about the image. */
export async function waitForImage(
  page: Page,
  id: string,
  check: (image: ImageSnap) => boolean,
  what: string,
): Promise<ImageSnap> {
  let latest: ImageSnap | null = null;
  await expect
    .poll(async () => {
      latest = await imageSnapshot(page, id);
      return latest !== null && check(latest);
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: `the image never became ${what}` })
    .toBe(true);
  return latest!;
}

/** The status the page is rendering for an image, straight off its box. */
export async function renderedStatus(page: Page, id: string): Promise<string | null> {
  return page.evaluate((target) => {
    const element = document.querySelector(`[data-testid="image-object-${target}"]`);
    return element ? element.getAttribute('data-status') : null;
  }, id);
}

/** Wait until the box the browser painted says this status. */
export async function waitForRenderedStatus(page: Page, id: string, status: string): Promise<void> {
  await expect
    .poll(async () => await renderedStatus(page, id), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: `the image was never shown as ${status}`,
    })
    .toBe(status);
}

export interface PaintedImage {
  /** The `<img>` the browser finished loading: its own natural size. */
  naturalWidth: number;
  naturalHeight: number;
  complete: boolean;
  /** The box the image is drawn in, in screen pixels. */
  width: number;
  height: number;
  src: string;
}

/** The picture as this browser drew it: the element, its box and what it loaded. */
export async function paintedImage(page: Page, id: string): Promise<PaintedImage | null> {
  return page.evaluate((target) => {
    const box = document.querySelector<HTMLElement>(`[data-testid="image-object-${target}"]`);
    const img = box?.querySelector<HTMLImageElement>('img.image-object__img');
    if (!box || !img) {
      return null;
    }
    const rect = box.getBoundingClientRect();
    return {
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      complete: img.complete,
      width: rect.width,
      height: rect.height,
      src: img.getAttribute('src') ?? '',
    };
  }, id);
}

/**
 * Wait until the image is a picture on this page: the model says ready and the
 * browser has the bytes (`naturalWidth` is only non-zero once they arrived).
 */
export async function waitForShownImage(page: Page, id: string): Promise<PaintedImage> {
  await waitForImage(page, id, (image) => image.status === 'ready', 'ready');
  let painted: PaintedImage | null = null;
  await expect
    .poll(async () => {
      painted = await paintedImage(page, id);
      return painted !== null && painted.complete && painted.naturalWidth > 0;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the picture never arrived in this browser' })
    .toBe(true);
  return painted!;
}

/** What the board is saying about files it will not take. */
export async function imageToasts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.image-toast .image-toast__message')].map(
      (node) => node.textContent ?? '',
    ),
  );
}

/** The state box an unfinished upload shows, if this page is rendering one. */
export async function stateBoxText(page: Page, id: string): Promise<string | null> {
  return page.evaluate((target) => {
    const box = document.querySelector<HTMLElement>(`[data-testid="image-object-${target}"] .image-object__state`);
    return box ? (box.textContent ?? '') : null;
  }, id);
}

export async function clickImageButton(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).click();
}

/**
 * Wait until this image is selected and its resize handles are up: the board's own
 * selection helpers read `object-*` test ids, and an image's box is `image-object-*`.
 */
export async function waitForImageSelected(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () =>
        await page.evaluate((target) => {
          const box = document.querySelector<HTMLElement>(`[data-testid="image-object-${target}"]`);
          return (
            box?.getAttribute('data-selected') === 'true' &&
            !!document.querySelector('[data-testid="resize-handle-se"]')
          );
        }, id),
      { timeout: E2E_EVENTUAL_TIMEOUT_MS, message: 'the image was never selected with its handles up' },
    )
    .toBe(true);
}

/** Click the middle of an image's box, which is what selects it. */
export async function clickImage(page: Page, image: ImageSnap): Promise<ScreenPoint> {
  const centre = await screenOfWorld(page, { x: image.x + image.width / 2, y: image.y + image.height / 2 });
  if (centre.x < 0 || centre.y < 0 || centre.x > VIEWPORT_WIDTH || centre.y > VIEWPORT_HEIGHT) {
    throw new Error(`the image at ${image.x},${image.y} is off this viewport`);
  }
  await page.mouse.click(centre.x, centre.y);
  return centre;
}

/** The screen box of the image object's own element. */
export async function imageBox(page: Page, id: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.locator(`[data-testid="image-object-${id}"]`).boundingBox();
  if (!box) {
    throw new Error(`image ${id} is not rendered`);
  }
  return box;
}

/**
 * Watch every status this page renders for every image, from now on.
 *
 * `image.uploading` is a moment, not a state that lasts, and a poll can miss it; a
 * MutationObserver on the board cannot. What it records is what a person on this
 * page would have seen.
 */
export async function startImageWatch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const store = window as unknown as { __imageStatuses?: Map<string, string[]> };
    store.__imageStatuses = new Map<string, string[]>();
    const record = (): void => {
      for (const element of document.querySelectorAll<HTMLElement>('[data-image-object]')) {
        const id = element.getAttribute('data-image-object');
        const status = element.getAttribute('data-status');
        if (!id || !status) {
          continue;
        }
        const seen = store.__imageStatuses!.get(id) ?? [];
        if (seen[seen.length - 1] !== status) {
          seen.push(status);
          store.__imageStatuses!.set(id, seen);
        }
      }
    };
    record();
    const observer = new MutationObserver(record);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-status', 'data-image-object'],
    });
  });
}

/** The statuses this page has shown for one image, in the order it showed them. */
export async function statusesShown(page: Page, id: string): Promise<string[]> {
  return page.evaluate((target) => {
    const store = window as unknown as { __imageStatuses?: Map<string, string[]> };
    return store.__imageStatuses?.get(target) ?? [];
  }, id);
}
