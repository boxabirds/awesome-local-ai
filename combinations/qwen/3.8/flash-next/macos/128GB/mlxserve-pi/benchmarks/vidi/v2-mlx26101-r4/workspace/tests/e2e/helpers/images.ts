/**
 * Putting pictures on a board from outside, and reading what the board did about it.
 *
 * Two ways in, because the product has two ways in: a file carried onto the board by a pointer, and a file chosen
 * out of a window. The first is done here the way a person does it — a `DataTransfer` built in the page from real
 * bytes, and `dragenter`, `dragover` and `drop` sent to the board in that order — rather than by calling the
 * function that adds an image, which would leave the drop handler itself untested. The second waits for the file
 * window the board opens and answers it, which is also how it proves that pressing `i` opens a file window at all:
 * if nothing opens, `waitForEvent('filechooser')` times out.
 *
 * Everything here is in board units on the way in and screen pixels on the way out, converted by the page's own
 * camera. The alternative — assuming the camera is where the last test left it — is how a test ends up dropping a
 * picture on the far side of the board and then looking for it in the wrong place.
 */
import { expect, type JSHandle, type Locator, type Page } from '@playwright/test';

import type { ImageSnap } from '../../../src/shared/objects/image';
import type { ImageFixture } from '../../fixtures/images';
import { pickable } from '../../fixtures/images';
import { board, settled, worldToScreen } from './board';
import type { Point } from './board';

export type { ImageFixture };

/** A box on a screen, in pixels. */
export interface PaintedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// The document this page holds
// ---------------------------------------------------------------------------

/** The pictures this page's document holds, in stacking order, with the upload state as the document has it. */
export async function imagesOnPage(page: Page): Promise<readonly ImageSnap[]> {
  return page.evaluate(() => window.__vidi6?.getImages() ?? []);
}

export async function imageOnPage(page: Page, id: string): Promise<ImageSnap> {
  const image = (await imagesOnPage(page)).find((entry) => entry.id === id);
  if (image === undefined) throw new Error(`this page's document has no image ${id}`);
  return image;
}

/** The ids of the pictures on this page's board, in the order they were made. */
export async function imageIds(page: Page): Promise<string[]> {
  return (await imagesOnPage(page)).map((image) => image.id);
}

// ---------------------------------------------------------------------------
// What is painted
// ---------------------------------------------------------------------------

/** Every picture painted on this page, placeholder or picture or not. */
export function imageElements(page: Page): Locator {
  return page.getByTestId('image-object');
}

/** The one picture painted for this id. There is one element per id: the box is the object, not a copy of it. */
export function imageElement(page: Page, id: string): Locator {
  return page.locator(`[data-image-id="${id}"]`);
}

/**
 * What the painted box says a picture's state is: `uploading`, `ready`, `failed`, `unfinished`, `unavailable` or
 * `unreadable`. `null` when there is no box at all.
 *
 * This is read off the page rather than out of the document on purpose. The document can say `ready` while the
 * component draws a progress bar, and the thing a person sees is the box.
 */
export async function imageStatus(page: Page, id: string): Promise<string | null> {
  return imageElement(page, id).getAttribute('data-image-status');
}

/** The words inside a picture's box: "Uploading…", "Upload failed", "Image unavailable", and so on. */
export async function imageMessage(page: Page, id: string): Promise<string | null> {
  const message = page.locator(`[data-image-id="${id}"] [data-testid="image-object-message"]`);
  if ((await message.count()) === 0) return null;
  return message.textContent();
}

/** The percentage drawn inside a progress bar, as the page shows it — "42%", or null when no bar is drawn. */
export async function imagePercent(page: Page, id: string): Promise<string | null> {
  const shown = page.locator(`[data-image-id="${id}"] [data-testid="image-object-percent"]`);
  if ((await shown.count()) === 0) return null;
  return shown.textContent();
}

/** Where a picture's box is on this page's screen, in pixels. */
export async function paintedBox(page: Page, id: string): Promise<PaintedBox> {
  const box = await imageElement(page, id).boundingBox();
  if (box === null) throw new Error(`picture ${id} is not painted on this page`);
  return { x: box.x, y: box.y, width: box.width, height: box.height };
}

/**
 * The proportions the box is drawn at: its width over its height, in pixels.
 *
 * Pixels and board units are different things and this is the ratio of the pixels, because a resize gesture that
 * lost the proportions would lose them on the screen whatever the camera says. At any zoom the two ratios are the
 * same number, which is what makes this worth measuring.
 */
export async function paintedRatio(page: Page, id: string): Promise<number> {
  const box = await paintedBox(page, id);
  return box.width / box.height;
}

/** The picture drawn inside a box: its address, and how many pixels it turned out to be. */
export async function paintedPicture(page: Page, id: string): Promise<{ src: string; naturalWidth: number; naturalHeight: number }> {
  return page.evaluate((imageId) => {
    const img = document.querySelector<HTMLImageElement>(`[data-image-id="${imageId}"] img`);
    if (img === null) throw new Error(`picture ${imageId} has no picture drawn in its box`);
    return { src: img.getAttribute('src') ?? '', naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  }, id);
}

/**
 * What the board answers when a stored picture is asked for: status, the headers, and how many bytes came.
 *
 * Asked from the page rather than from the test's own HTTP client, because the thing worth knowing is what this
 * browser gets from the address it was handed. The headers cannot be read off the drawn `<img>`: a picture that
 * arrived is a picture that arrived, whether the board said it may be kept for a year or for a second.
 */
export async function assetResponse(
  page: Page,
  key: string,
): Promise<{ status: number; cacheControl: string | null; contentType: string | null; bytes: number }> {
  return page.evaluate(async (address) => {
    const response = await fetch(address);
    const body = await response.arrayBuffer();
    return {
      status: response.status,
      cacheControl: response.headers.get('cache-control'),
      contentType: response.headers.get('content-type'),
      bytes: body.byteLength,
    };
  }, `/api/assets/${key}`);
}

/**
 * Waits until a browser has the picture, then reads what it got.
 *
 * `naturalWidth` is zero until the bytes behind the address have arrived and been decoded, which happens a moment
 * after the document says the upload is ready: the document is written by the upload, and the picture is fetched by
 * the box drawn underneath it. A test that reads the box in between is looking at a picture that is still on its way
 * and sees no picture at all, so it waits for the one number that can only mean the bytes came — and if nothing ever
 * comes back, that is what the failure says.
 */
export async function waitForPictureDrawn(
  page: Page,
  id: string,
  timeoutMs = 20_000,
): Promise<{ src: string; naturalWidth: number; naturalHeight: number }> {
  await expect
    .poll(() => paintedPicture(page, id).then((drawn) => drawn.naturalWidth), {
      timeout: timeoutMs,
      message: `picture ${id} was never drawn: nothing came back from its address`,
    })
    .toBeGreaterThan(0);
  return paintedPicture(page, id);
}

/**
 * That a picture is painted where this page's camera says its own box is.
 *
 * The tolerance is in screen pixels and is passed in rather than assumed, because the two things being compared are
 * a number written into a document and a box a browser laid out: an image's box is sized by a transform and a
 * percentage, and a browser that rounds a 533.333 unit width to 533 is not wrong.
 */
export async function expectPaintedMatches(
  page: Page,
  image: ImageSnap,
  tolerance: number,
  note = 'the box is where the object says it is',
): Promise<void> {
  const camera = await settled(page);
  const box = await paintedBox(page, image.id);
  const from = worldToScreen(camera, { x: image.x, y: image.y });
  const within = (actual: number, expected: number, which: string): void => {
    expect(Math.abs(actual - expected), `${note}: ${which} (${actual}, expected ${expected})`).toBeLessThanOrEqual(
      tolerance,
    );
  };
  within(box.x, from.x, 'left edge');
  within(box.y, from.y, 'top edge');
  within(box.width, image.width * camera.zoom, 'width');
  within(box.height, image.height * camera.zoom, 'height');
}

// ---------------------------------------------------------------------------
// Waiting for a state, and writing down how long it took
// ---------------------------------------------------------------------------

/**
 * Waits for a picture's box to reach a state, and hands back how many milliseconds that took from `since`.
 *
 * The elapsed time is what an e2e test about an upload cannot assert and should not throw away: the bytes travel
 * from the page to a local object store and back, on a machine that is also running the browser. Reported, then
 * used by whoever reads the run.
 */
export async function waitForImageStatus(
  page: Page,
  id: string,
  status: string,
  options: { since?: number; timeoutMs?: number } = {},
): Promise<number> {
  const started = options.since ?? Date.now();
  const timeout = options.timeoutMs ?? 30_000;
  const deadline = started + timeout;
  let seen: string | null = null;
  for (;;) {
    seen = await imageStatus(page, id);
    if (seen === status) break;
    if (Date.now() > deadline) {
      throw new Error(`picture ${id} was last "${seen}" and never became "${status}" within ${timeout} ms`);
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 25));
  }
  const ms = Date.now() - started;
  console.log(`  [image] picture ${id} reached "${status}" ${ms} ms after the drop`);
  return ms;
}

/** The ids of the pictures on this page's board, once there are the number asked for. */
export async function waitForImageCount(page: Page, count: number, timeoutMs = 30_000): Promise<string[]> {
  await expect
    .poll(() => imagesOnPage(page).then((images) => images.length), {
      timeout: timeoutMs,
      message: `expected ${count} picture(s) on the board`,
    })
    .toBe(count);
  return imageIds(page);
}

// ---------------------------------------------------------------------------
// Putting files on the board
// ---------------------------------------------------------------------------

/**
 * Builds a `DataTransfer` in the page out of real file bytes.
 *
 * The bytes cross as base64 text and are turned back into a file inside the page. They are not passed as a Node
 * `Buffer`, which is the obvious thing to try and does not work: a Buffer arrives as an object rather than as
 * bytes, and the file made out of it has no content at all — a zero-byte "PNG" that the board refuses as not a
 * picture, which looks exactly like a board that cannot read a valid file. This is checked by the tests themselves:
 * a drop that arrives with nothing in it produces a refusal and no picture, and every test in this file would fail
 * with a message about the wrong thing.
 */
async function transferOf(page: Page, files: readonly ImageFixture[]): Promise<JSHandle<DataTransfer>> {
  return page.evaluateHandle((described) => {
    const transfer = new DataTransfer();
    for (const file of described) {
      const raw = atob(file.base64);
      const bytes = new Uint8Array(raw.length);
      for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
      transfer.items.add(new File([bytes], file.name, { type: file.type }));
    }
    return transfer;
  }, files.map((file) => ({ name: file.name, type: file.type, base64: file.bytes.toString('base64') })));
}

/**
 * Drag these files onto the board at this place in board units, and let go.
 *
 * All three events, in order, because the board only offers to take a file once something has been carried over it:
 * a `drop` sent on its own would be testing a path the browser never takes, and would leave the highlight untested.
 * The place is converted with the page's own camera, which is read after the camera has stopped moving.
 */
export async function dropPictures(
  page: Page,
  at: Point,
  files: readonly ImageFixture[],
): Promise<void> {
  const camera = await settled(page);
  const where = worldToScreen(camera, at);
  const frame = await board(page).boundingBox();
  const point = { x: where.x + (frame?.x ?? 0), y: where.y + (frame?.y ?? 0) };

  const dataTransfer = await transferOf(page, files);
  await board(page).dispatchEvent('dragenter', { dataTransfer, clientX: point.x, clientY: point.y });
  await board(page).dispatchEvent('dragover', { dataTransfer, clientX: point.x, clientY: point.y });
  await board(page).dispatchEvent('drop', { dataTransfer, clientX: point.x, clientY: point.y });
  await dataTransfer.dispose();
}

/** Whether the board is offering to take what is being carried: the highlight a person sees while hovering. */
export async function dropIsOffered(page: Page): Promise<boolean> {
  return (await page.locator('[data-testid="drop-highlight"]').count()) > 0;
}

/** Carry files over the board and hold them there, without dropping: the state the highlight is about. */
export async function carryOverBoard(page: Page, files: readonly ImageFixture[]): Promise<void> {
  const camera = await settled(page);
  const where = worldToScreen(camera, { x: 100, y: 100 });
  const dataTransfer = await transferOf(page, files);
  await board(page).dispatchEvent('dragenter', { dataTransfer, clientX: where.x, clientY: where.y });
  await board(page).dispatchEvent('dragover', { dataTransfer, clientX: where.x, clientY: where.y });
  await dataTransfer.dispose();
}

/** Carry the files over the board and then away again, which is a drop that did not happen. */
export async function carryAwayFromBoard(page: Page): Promise<void> {
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await board(page).dispatchEvent('dragleave', { dataTransfer });
  await dataTransfer.dispose();
}

/**
 * The file window the board was asked to open, waiting to be answered.
 *
 * The waiting starts before the key press or the button click that opens the window, because `filechooser` is an
 * event and not a state: once the press has come back the moment has already gone, and a test that starts looking
 * for the window afterwards is waiting for a window that was and closed. Asking for it first is also what makes
 * this an assertion about the key: if the board opens nothing, `answer` throws with the browser's own reason.
 */
export interface FileWindow {
  /** Give the window these files, which is what a person picking files in a window amounts to. */
  answer(files: readonly ImageFixture[]): Promise<void>;
}

export function expectFileWindow(page: Page, asked: string): FileWindow {
  const pending = page.waitForEvent('filechooser');
  let failure: Error | null = null;
  // Nothing is waiting on this yet, and nothing should be handed a rejection it never asked for. The failure is
  // kept and thrown by `answer`, where there is a test to fail.
  pending.catch((error: Error) => {
    failure = error;
  });
  return {
    async answer(files: readonly ImageFixture[]): Promise<void> {
      if (failure !== null) {
        throw new Error(`${asked}: no file window opened — ${String(failure)}`);
      }
      const chooser = await pending;
      await chooser.setFiles(pickable(files));
    },
  };
}

/**
 * Everything the board has said in a toast, oldest first.
 *
 * Toasts are how a board explains that it refused something, so they are read here as text and compared as text:
 * the message is the product's sentence, from `REJECTION_MESSAGES`, not a paraphrase of it.
 */
export async function toastTexts(page: Page): Promise<string[]> {
  return page.locator('[data-testid="toast"]').allTextContents();
}

/** The messages inside the picture boxes of this page, in stacking order: what the whole board is saying. */
export async function imageMessages(page: Page): Promise<(string | null)[]> {
  const ids = await imageIds(page);
  return Promise.all(ids.map((id) => imageMessage(page, id)));
}

/**
 * A drop, awaited to the end: the files are on the board and every one of them says it has arrived.
 *
 * Returns the ids in the order they were placed, so a test can talk about a particular picture afterwards, and the
 * time from the drop to the last arrival, which no assertion is made about.
 */
export async function dropPicturesAndAwait(
  page: Page,
  at: Point,
  files: readonly ImageFixture[],
): Promise<{ ids: string[]; ms: number }> {
  const since = Date.now();
  await dropPictures(page, at, files);
  const ids = await waitForImageCount(page, files.length, 15_000);
  let slowest = 0;
  for (const id of ids) slowest = Math.max(slowest, await waitForImageStatus(page, id, 'ready', { since }));
  return { ids, ms: slowest };
}
