// Picture helpers for the story-12 end-to-end tests: files a browser can really decode, the
// three doors a person hands one over (a drag, a paste, the file picker), and what the board
// says about the pictures it holds.
//
// The bytes are drawn by the browser under test rather than written out here. A hand-written
// PNG is a byte pattern that a particular decoder happens to like today; a file that came out
// of `canvas.toDataURL` is a file that browser itself agreed to make, which is the thing this
// story's promise rests on ("the browser can decode it"). The bytes then travel back to Node so
// that the same file can be handed to any of the three doors, on any browser, in the same test.

import { expect, type FileChooser, type Locator, type Page } from '@playwright/test';
import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';
import type { ImageSnapshot } from '../../../src/shared/objects/image';
import type { Point } from './board';

/** The formats a person can hand over, named the way a file extension names them. */
export type PictureKind = 'png' | 'jpeg' | 'webp' | 'gif';

const PICTURE_MIME: Record<PictureKind, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * Which of these formats the browser under test can write a real file in.
 *
 * Asked for a format it does not write, a canvas answers in another one without a word - WebKit
 * hands back a PNG when asked for a WebP - so the only way to know is to ask and look at what
 * came. This is a fact about the browser being tested, not about the board: every one of them is
 * asked to display every format the board accepts, and the ones that cannot write a WebP
 * themselves are handed one by a browser that can, or given a GIF instead.
 */
export async function writablePictureKinds(page: Page): Promise<PictureKind[]> {
  const written = await page.evaluate((mimes: Record<string, string>) => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 4;
    const can = (kind: string, mime: string): boolean =>
      kind === 'png' || canvas.toDataURL(mime).startsWith(`data:${mime};`);
    return Object.entries(mimes)
      .filter(([kind, mime]) => can(kind, mime))
      .map(([kind]) => kind);
  }, PICTURE_MIME);
  return written.filter((kind): kind is PictureKind => kind in PICTURE_MIME);
}

/**
 * A picture in whichever accepted format is least ordinary for this browser.
 *
 * A test that asks for "a file the board will take" should not quietly become a test about PNGs
 * everywhere: the ordinary formats are covered by every other test, so this starts at the formats
 * a board is most likely to get wrong and takes the first one this browser can really write.
 */
export async function anAcceptedPicture(
  page: Page,
  width: number,
  height: number,
): Promise<Picture> {
  const writable = await writablePictureKinds(page);
  for (const kind of ['webp', 'gif', 'jpeg', 'png'] as PictureKind[]) {
    if (writable.includes(kind)) return picture(page, kind, width, height);
  }
  throw new Error('this browser cannot write a picture at all');
}

/** One file, held here in Node so it can be handed to any door on any browser. */
export interface Picture {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
  /** What the file measures, when it is a picture at all: 0 by 0 for a file never meant to be. */
  width: number;
  height: number;
}

/** The state of one picture on the board, as the board itself reports it. */
export interface PictureState {
  id: string;
  status: string;
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
  assetKey: string | null;
  contentType: string;
}

/** A file that is only a name and some bytes: for a door that never asks what is in them. */
export function aFile(name: string, mimeType: string, bytes: Uint8Array): Picture {
  return { name, mimeType, bytes, width: 0, height: 0 };
}

/** Bytes as they travel into a page: `atob` in the browser, `Buffer` here. */
function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

/**
 * A picture of an exact size, drawn in the page and carried back.
 *
 * The drawing is not decoration: a canvas the test can get an answer out of is a canvas the
 * browser can decode later, and a flat one-pixel file would let a broken `<img>` pass for a
 * working one.
 */
export async function picture(
  page: Page,
  kind: PictureKind,
  width: number,
  height: number,
  name = `screenshot.${kind === 'jpeg' ? 'jpg' : kind}`,
): Promise<Picture> {
  const mimeType = PICTURE_MIME[kind];
  const dataUrl = await page.evaluate(
    async ({ mime, w, h }: { mime: string; w: number; h: number }) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const context = canvas.getContext('2d');
      if (context === null) throw new Error('this browser has no canvas');
      context.fillStyle = '#2f6f4f';
      context.fillRect(0, 0, w, h);
      context.fillStyle = '#f2c14e';
      context.fillRect(0, 0, Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
      context.fillStyle = '#e0533d';
      context.beginPath();
      context.arc(w / 2, h / 2, Math.max(1, Math.min(w, h) / 3), 0, Math.PI * 2);
      context.fill();
      return canvas.toDataURL(mime);
    },
    { mime: mimeType, w: width, h: height },
  );
  const prefix = `data:${mimeType};base64,`;
  if (!dataUrl.startsWith(prefix)) {
    // A browser that cannot write the format asked for says so by answering with another one. Ask
    // the browser what it can write (`writablePictureKinds`) rather than guessing by browser name.
    throw new Error(
      `this browser will not draw a ${mimeType} (answered ${dataUrl.slice(0, 24)}) - ask it which formats it writes`,
    );
  }
  return {
    name,
    mimeType,
    bytes: atobNode(dataUrl.slice(prefix.length)),
    width,
    height,
  };
}

function atobNode(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, 'base64'));
}

/** The arguments for a page evaluation that has to rebuild the files. */
function wire(files: readonly Picture[]): { name: string; mimeType: string; base64: string }[] {
  return files.map((file) => ({
    name: file.name,
    mimeType: file.mimeType,
    base64: toBase64(file.bytes),
  }));
}

/**
 * Drag files onto the board and let go at a screen point.
 *
 * A mouse drag cannot carry files, so the drag is built in the page out of the same parts a real
 * one is built out of: a `DataTransfer` holding the files, and the enter / over / drop events a
 * drop is made of. The point is carried as `clientX` / `clientY`, because where a picture lands
 * is the whole point of dropping it somewhere.
 */
export async function dropPictures(
  page: Page,
  at: Point,
  files: readonly Picture[],
): Promise<void> {
  await page.evaluate(
    ({ at: point, files: payloads }: { at: Point; files: ReturnType<typeof wire> }) => {
      const transfer = new DataTransfer();
      for (const file of payloads) {
        transfer.items.add(
          new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.name, {
            type: file.mimeType,
          }),
        );
      }
      const target =
        document.elementFromPoint(point.x, point.y) ??
        document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
      if (target === null) throw new Error('the board is not on screen');
      for (const kind of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(
          new DragEvent(kind, {
            bubbles: true,
            cancelable: true,
            clientX: point.x,
            clientY: point.y,
            dataTransfer: transfer,
          }),
        );
      }
    },
    { at, files: wire(files) },
  );
}

/** A drag of files that stops short of being dropped, and the same drag leaving. */
/**
 * Hold up the way a page's uploads travel, so that "the bytes are on their way" is a state a test
 * can look at rather than one it has to win a race with.
 *
 * Three small pictures over a loopback connection are written and acknowledged in less time than
 * it takes to ask the board what it thinks, and the waiting state - the one a person actually
 * sees, and the reason a box is drawn at its final size before its picture arrives - would be
 * over before the test noticed. Only the uploads are held up: a page still reads its pictures at
 * full speed, and nothing about the board's own behaviour is changed, only the road.
 */
export async function slowTheWayToTheBytes(page: Page, ms = 600): Promise<void> {
  await page.route('**/api/assets/**', async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

export async function dragPicturesOver(
  page: Page,
  at: Point,
  files: readonly Picture[],
  leave = false,
): Promise<void> {
  await page.evaluate(
    ({
      at: point,
      files: payloads,
      goingAway,
    }: {
      at: Point;
      files: ReturnType<typeof wire>;
      goingAway: boolean;
    }) => {
      const transfer = new DataTransfer();
      for (const file of payloads) {
        transfer.items.add(
          new File([Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0))], file.name, {
            type: file.mimeType,
          }),
        );
      }
      const target =
        document.elementFromPoint(point.x, point.y) ??
        document.querySelector<HTMLElement>('[data-testid="board-viewport"]');
      if (target === null) throw new Error('the board is not on screen');
      target.dispatchEvent(
        new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      target.dispatchEvent(
        new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }),
      );
      if (goingAway) {
        target.dispatchEvent(
          new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: transfer }),
        );
      }
    },
    { at, files: wire(files), goingAway: leave },
  );
}


/** A file's bytes in the shape the file picker is answered with. */
function bufferOf(file: Picture): Buffer {
  return Buffer.from(file.bytes.buffer, file.bytes.byteOffset, file.bytes.byteLength);
}


/**
 * Open the picker the way a person does - with the button or with the key - and answer it.
 *
 * A file chooser is the event a browser raises when something clicks a file input, so this walk
 * is the whole way through the door: key or click, chooser, answer. Answering with no files at
 * all is what a person who thought better of it does, and the board is to have changed nothing.
 */
export async function answerPicker(
  page: Page,
  open: () => Promise<void>,
  files: readonly Picture[],
): Promise<void> {
  const choosing = nextChooser(page);
  await open();
  const chooser = await choosing;
  await chooser.setFiles(
    files.map((file) => ({ name: file.name, mimeType: file.mimeType, buffer: bufferOf(file) })),
  );
}

/**
 * Watch a page's file choosers, so that one is never missed.
 *
 * Playwright only starts telling a page about its choosers once something is listening, and that
 * instruction takes a round trip to reach the browser. A test that listens and presses the key in
 * the same breath therefore sometimes never hears about the dialog it caused - not a bug in the
 * board, and not a thing a person would notice, since a person's dialog is on their own screen.
 * So the listening starts before the page is even opened, and choosers that arrive early wait in
 * line for whoever asks for them.
 */
export function watchPicturePickers(page: Page): void {
  if (pickers.has(page)) return;
  const picker: Picker = { queued: [], waiting: [] };
  pickers.set(page, picker);
  page.on('filechooser', (chooser) => {
    const next = picker.waiting.shift();
    if (next !== undefined) next(chooser);
    else picker.queued.push(chooser);
  });
}

/** The chooser this page opens next, or the one it opened before anyone asked. */
async function nextChooser(page: Page): Promise<FileChooser> {
  const picker = pickers.get(page);
  if (picker === undefined) throw new Error('call watchPicturePickers(page) before the picker');
  const queued = picker.queued.shift();
  if (queued !== undefined) return queued;
  return new Promise<FileChooser>((resolve) => {
    picker.waiting.push(resolve);
  });
}

interface Picker {
  queued: FileChooser[];
  waiting: ((chooser: FileChooser) => void)[];
}

const pickers = new WeakMap<Page, Picker>();

/** The board's own picture of its pictures. */
export async function pictureStates(page: Page): Promise<PictureState[]> {
  return page.evaluate(
    () =>
      (
        (window as unknown as { __vidi6?: { __images?(): readonly ImageSnapshot[] } }).__vidi6
          ?.__images?.() ?? []
      ).map((image) => ({
        id: image.id,
        status: image.status,
        x: image.x,
        y: image.y,
        width: image.width,
        height: image.height,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        assetKey: image.assetKey,
        contentType: image.contentType,
      })),
  );
}


/**
 * The one picture there is to be.
 *
 * A test that reads `list[0]` gets `undefined` and then a complaint about a property of nothing;
 * this instead says the thing that is actually wrong.
 */
export function theOnly(images: readonly PictureState[]): PictureState {
  if (images.length !== 1) throw new Error(`expected one picture, the board has ${images.length}`);
  const [only] = images;
  if (only === undefined) throw new Error('the board has no pictures');
  return only;
}

/** The boxes the board has painted, in painted order. */
export async function pictureBoxes(
  page: Page,
): Promise<{ id: string; x: number; y: number; width: number; height: number }[]> {
  return page
    .getByTestId('image-object')
    .evaluateAll((els) =>
      els.map((el) => {
        const node = el as HTMLElement;
        const box = node.getBoundingClientRect();
        return {
          id: node.dataset.imageId ?? '',
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        };
      }),
    );
}


/** What the status line of a painted picture says. */
export async function pictureWords(page: Page, index: number): Promise<string> {
  const line = await pictureCards(page).nth(index).getByTestId('image-status').textContent();
  return (line ?? '').trim();
}

export function pictureCards(page: Page): Locator {
  return page.getByTestId('image-object');
}

/**
 * Whether the board takes this picture as one of the things it has picked out.
 *
 * Read off the paint rather than out of the document, because being picked out is a thing one
 * screen's mouse does: whether a press on the picture reaches the picture is exactly what a
 * stylesheet can get wrong.
 */
export async function pictureIsSelected(page: Page, id: string): Promise<boolean> {
  const flag = await page
    .locator(`[data-testid="image-object"][data-image-id="${id}"]`)
    .getAttribute('data-selected');
  return flag === 'true';
}

export function dropHighlight(page: Page): Locator {
  return page.getByTestId('drop-highlight');
}

export function imageToolButton(page: Page): Locator {
  return page.getByTestId('tool-image');
}

export function retryButton(page: Page, index: number): Locator {
  return pictureCards(page).nth(index).getByTestId('image-retry');
}


/** The board's own sentences, in the order they were said. */
export async function toastLines(page: Page): Promise<string[]> {
  const lines = await page.getByTestId('toast').allTextContents();
  return lines.map((line) => line.trim()).filter((line) => line !== '');
}

/** Wait until the board holds `count` pictures, and hand them back. */
export async function waitForPictures(page: Page, count: number): Promise<PictureState[]> {
  let seen: PictureState[] = [];
  await expect
    .poll(async () => {
      seen = await pictureStates(page);
      return seen.length;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(count);
  return seen;
}

/** Wait until every picture has the status asked for. */
export async function waitForPictureStatus(
  page: Page,
  status: string,
  count: number,
): Promise<PictureState[]> {
  let seen: PictureState[] = [];
  await expect
    .poll(async () => {
      seen = await pictureStates(page);
      return seen.filter((image) => image.status === status).length;
    }, { timeout: E2E_EVENTUAL_TIMEOUT_MS })
    .toBe(count);
  return seen;
}

/** Wait until two boards agree about their pictures: same ones, in the same state. */
export async function waitForPicturesMatch(left: Page, right: Page): Promise<PictureState[]> {
  let seen: PictureState[] = [];
  await expect
    .poll(
      async () => {
        seen = await pictureStates(left);
        return agreeing(seen, await pictureStates(right));
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toBe(true);
  return seen;
}

/** Whether two boards would answer the same to anything a person could ask about pictures. */
function agreeing(left: readonly PictureState[], right: readonly PictureState[]): boolean {
  return stateOf(left) === stateOf(right);
}

/** The parts of a picture that two boards have to agree about. */
function stateOf(images: readonly PictureState[]): string {
  return JSON.stringify(
    [...images]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((image) => [
        image.id,
        image.status,
        image.assetKey,
        image.width,
        image.height,
        image.naturalWidth,
        image.naturalHeight,
      ]),
  );
}

/** How far two boards are from agreeing, for a test that has to say it out loud. */
export function pictureDifference(
  left: readonly PictureState[],
  right: readonly PictureState[],
): string {
  return agreeing(left, right) ? '' : `${stateOf(left)} vs ${stateOf(right)}`;
}


/**
 * Wait until this board would take a file.
 *
 * A picture has to have somewhere to go, so a board still looking for its room turns files away
 * rather than queueing them up and hoping. A test that hands one over a moment too early is
 * therefore not testing the board a person would have handed a file to. What the badge says is
 * what a person sees, so that is what is waited for: `connected`, or `confirmed` once the room
 * has said it wrote the board down.
 */
export async function waitForUploadable(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const state = await page.evaluate(
          () =>
            (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6
              ?.connectionState ?? '',
        );
        return state === 'connected' || state === 'confirmed';
      },
      { timeout: E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toBe(true);
}

/** The URL a browser would be pointed at for these bytes. */
export function assetUrl(assetKey: string): string {
  return `/api/assets/${assetKey}`;
}

/** Every screen point a dropped row of pictures can be aimed at, inside the starting view. */
export const BOARD_POINT: Point = { x: 640, y: 420 };
