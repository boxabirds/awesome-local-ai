/// <reference path="../../../src/client/testHooks.ts" />
/**
 * Getting files onto a board, and reading the pictures back off it, in a real browser.
 *
 * Story 12 is the first story in this repository where the thing a person does is not a gesture: nobody
 * clicks a "add image" button and types in a filename, they drag a file out of Finder and let go over the
 * board, or they press Cmd+V, or they press I and pick something from a dialog. Playwright can do all
 * three, and each one needs its own trick, which is what this file is for - and the tricks are worth
 * writing down, because two of them look like they work while proving nothing.
 *
 * **Drag and drop.** Playwright's own `locator.dispatchEvent('drop', { dataTransfer })` builds the event
 * for you; this file does not use it, because the board's handlers are native listeners on the surface
 * element and they read `clientX`/`clientY` to decide where the pictures go, and those are getters that
 * cannot be assigned onto a finished event. So the event is constructed inside the page, where a
 * `DragEvent` takes a `MouseEventInit` and a `DataTransfer` in the same constructor, and the coordinates
 * are real. The `DataTransfer` is filled with real `File`s built from real bytes read off disk, so what
 * arrives at the board is a file with a name, a type the browser inferred from that name, and the bytes a
 * decoder will make an image out of. A test that passed a file through some other channel would be
 * testing the board's arithmetic and not the board's promises.
 *
 * **Paste** is the same thing with one snag: a `ClipboardEvent`'s `clipboardData` is read-only and the
 * constructor always sets it to null, so it is redefined on the one event object being dispatched. It is
 * dispatched on the element that has the focus and allowed to bubble, because that is the route a real
 * paste takes to the window listener the board hangs.
 *
 * **The file dialog** is the one that has to be done properly. Pressing I calls `input.click()`, which in
 * a browser with a desktop opens a dialog Playwright cannot see; the `filechooser` event is what the
 * browser reports instead, and answering it is the only version of this test that goes through the tool
 * rather than around it. `setInputFiles` on the input directly is kept for the one thing it is better at:
 * choosing the same file twice, which is a claim about the input being emptied between uses.
 *
 * The reading half lives here too, because the questions are the same question: what is on the board, and
 * in what state. Everything is read out of the DOM the client itself drew, never out of the Y.Doc - a
 * document that holds a picture and a screen that shows it are two different facts, and this story is
 * about the second one.
 */
import { expect, type Page } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../../src/shared/config';
import type { Point } from '../../../src/shared/geometry';
import { screenToWorld } from '../../../src/client/canvas/camera';
import {
  fixtureBytes,
  type ImageFixtureName,
} from '../../fixtures/node/imageFiles';
import { readCamera, type ScreenPoint } from './board';

/** A file as the browser would have handed it over: a name, a type it inferred from that name, and bytes. */
export interface PageFile {
  readonly name: string;
  readonly type: string;
  readonly bytes: Uint8Array;
}

/**
 * A fixture file, at the size and type the person would have seen in their file list.
 *
 * These are the real things in `tests/fixtures/images/`: a 1440x900 PNG screenshot, a JPEG photograph, an
 * animated GIF, a WebP, an SVG with a script in it, a PDF whose name ends in `.png`, a PNG that stops
 * halfway through its pixels. The last three matter as much as the first three: the story is as much about
 * the files the board refuses as the ones it takes.
 */
export function aFile(name: ImageFixtureName): PageFile {
  return { name, type: mimeOf(name), bytes: fixtureBytes(name) };
}

/** The type a browser's file picker reports for a file with this extension. */
function mimeOf(name: ImageFixtureName): string {
  const byExtension: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
  };
  return byExtension[name.slice(name.lastIndexOf('.') + 1)] ?? 'application/octet-stream';
}

/** A fixture under a different name - which is how a file that lies about what it is usually arrives. */
export function aFileNamed(name: ImageFixtureName, as: string, type: string): PageFile {
  return { name: as, type, bytes: fixtureBytes(name) };
}

/**
 * A JPEG bigger than the board will take.
 *
 * Made here rather than kept on disk: eleven million bytes in a repository, for a test that only ever asks
 * "is this bigger than ten million?", is a poor trade. The bytes in front are a real JPEG's, because the
 * board measures a file before it looks inside it and the order is the thing being tested - the refusal
 * must come from the size, and must arrive before anything has been decoded or uploaded.
 */
export function anOversizeJpeg(): PageFile {
  return {
    name: 'holiday.jpg',
    type: 'image/jpeg',
    // Past the limit by a million bytes, so that a limit misread as megabytes times 1024 still refuses it
    // and the test says why.
    bytes: pad(fixtureBytes('photo.jpg'), IMAGE_MAX_BYTES + 1_000_000),
  };
}

/** A file the size a person would call "a photo", for the batch that goes over the count limit. */
export function filesUpTo(count: number): PageFile[] {
  const base = fixtureBytes('tiny.jpg');
  return Array.from({ length: count }, (_, index) => ({
    name: `photo-${index + 1}.jpg`,
    type: 'image/jpeg',
    bytes: base,
  }));
}

/** More files in one go than the board takes in a batch. */
export function tooManyFiles(): PageFile[] {
  return filesUpTo(IMAGE_MAX_FILES_PER_ADD + 3);
}

function pad(bytes: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(bytes, 0);
  return out;
}

/* ---------------------------------------------------------------------- putting files on the board */

/**
 * The bytes, the name and the type, as they cross into the page.
 *
 * They cross as plain data and the `File` is made on the other side, in the same call that dispatches the
 * events - which is fussy-looking, and the reason is a real one. A `DataTransfer` handed to `page.evaluate`
 * as an argument does not arrive as a `DataTransfer`: it is a live browser object, it cannot be copied, and
 * what shows up is an empty something that a `DragEvent` constructor refuses outright. Everything has to be
 * built where it is used.
 */
interface PageTransfer {
  name: string;
  type: string;
  bytes: Uint8Array;
}

function transfersOf(files: readonly PageFile[]): PageTransfer[] {
  return files.map((file) => ({ name: file.name, type: file.type, bytes: file.bytes }));
}

/** The element a drop at this screen point would land on, in words a failing test can use. */
async function surfaceAt(page: Page, at: ScreenPoint): Promise<string> {
  return page.evaluate(({ x, y }) => {
    const surface = document.querySelector('[data-testid="board-viewport"]');
    const element = document.elementFromPoint(x, y);
    if (element === null) {
      return '(nothing at that point)';
    }
    // Anything the board draws inside its surface counts as the board: the origin crosshair, a grid cell,
    // the world layer, a picture already on it. What must not be there is a control - dropping onto the
    // toolbar is a person aiming at the toolbar, and a test that did it by accident would be dropping files
    // somewhere nobody was.
    if (surface !== null && surface.contains(element)) {
      return 'board-viewport';
    }
    const control = element.closest('[data-board-ui]');
    return control === null
      ? element.getAttribute('data-testid') ?? element.tagName
      : `a control (${control.getAttribute('data-testid') ?? control.tagName})`;
  }, at);
}

/**
 * Drag `files` onto the board at a screen point and let go.
 *
 * The point is in viewport pixels, and the world point it turned into is given back: a file is dragged to
 * somewhere on the *screen*, which is the one place a test can name without knowing how the board is
 * currently framed, and the world coordinates are what the board does with those pixels, which is the
 * thing being checked. A test that aimed in world units would have to know the camera to aim at the middle
 * of the board, and the camera is one of the things it is testing.
 *
 * The three events a drop is made of go in order, at the same coordinates, in the same transfer: the board
 * puts its highlight up on the first and places the pictures by the coordinates in the last, so a test that
 * dispatched only the drop would be testing a board that was never told a drag was coming.
 */
export async function dropFiles(
  page: Page,
  at: ScreenPoint,
  files: readonly PageFile[],
): Promise<Point> {
  expect(
    await surfaceAt(page, at),
    'a drop on the board should land on the board itself, not on a control',
  ).toBe('board-viewport');
  const where = await worldAt(page, at);
  await page.evaluate(
    ({ entries, x, y }) => {
      const transfer = new DataTransfer();
      for (const entry of entries) {
        const bytes = new Uint8Array(entry.bytes.length);
        bytes.set(entry.bytes);
        transfer.items.add(new File([bytes], entry.name, { type: entry.type }));
      }
      const surface = document.elementFromPoint(x, y);
      if (surface === null) {
        throw new Error('there is nothing on the page where the drop was aimed');
      }
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
    { entries: transfersOf(files), x: at.x, y: at.y },
  );
  return where;
}

/** Drop one file, and say where in the world it landed. */
export async function dropOneFile(page: Page, at: ScreenPoint, file: PageFile): Promise<Point> {
  return dropFiles(page, at, [file]);
}

/** What world point these pixels are pointing at, on this page, at the camera it has now. */
export async function worldAt(page: Page, at: ScreenPoint): Promise<Point> {
  const camera = await readCamera(page);
  return screenToWorld(camera, at);
}

/**
 * Paste `files`, from whatever element has the focus.
 *
 * `clipboardData` cannot be given to a `ClipboardEvent`'s constructor - the spec makes it read-only and the
 * browser always hands back null - so it is defined onto this one event object on its way to the listener.
 * That is the same object a real paste would have carried: a `DataTransfer` with `files` in it, which is
 * what the board looks at.
 */
export async function pasteFiles(page: Page, files: readonly PageFile[]): Promise<void> {
  const reached = await page.evaluate((entries) => {
    const transfer = new DataTransfer();
    for (const entry of entries) {
      const bytes = new Uint8Array(entry.bytes.length);
      bytes.set(entry.bytes);
      transfer.items.add(new File([bytes], entry.name, { type: entry.type }));
    }
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(event);
    return target.getAttribute('data-testid') ?? target.tagName;
  }, transfersOf(files));
  expect(
    reached,
    'a paste should reach the board rather than a text field',
  ).not.toBe('sticky-note-editor');
}

/** Paste one file. */
export async function pasteOneFile(page: Page, file: PageFile): Promise<void> {
  await pasteFiles(page, [file]);
}

/**
 * Press the Image tool and answer the dialog it opens.
 *
 * This is the whole of TC-26's "press I, choose files": the key is pressed, the browser reports that a
 * dialog was asked for, and the files are handed to that report. Nothing here touches the input directly,
 * so the test goes through the tool - and if the tool ever stops opening a dialog, this fails, which is
 * the correct thing for it to do.
 */
export async function chooseWithImageTool(page: Page, files: readonly PageFile[]): Promise<void> {
  const asked = page.waitForEvent('filechooser');
  await page.keyboard.press('i');
  const chooser = await asked;
  expect(
    chooser.isMultiple(),
    'the board asks for a dialog that takes more than one file',
  ).toBe(true);
  await chooser.setFiles(payloadsOf(files));
}

/**
 * Hand files straight to the picker's input.
 *
 * For the one claim that needs it: choosing the same file twice in a row adds it twice. That is a promise
 * about the input being emptied between uses, and going through the dialog twice would prove the browser
 * can open a dialog twice.
 */
export async function pickFiles(page: Page, files: readonly PageFile[]): Promise<void> {
  await page.locator('input[data-image-picker]').setInputFiles(payloadsOf(files));
}

/** What Playwright's file chooser is handed: a name, a type, and the bytes. */
interface PickerPayload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

function payloadsOf(files: readonly PageFile[]): PickerPayload[] {
  return files.map((file) => ({
    name: file.name,
    mimeType: file.type,
    buffer: Buffer.from(file.bytes),
  }));
}

/** The Image tool's button, for the tests that prefer a click to a key. */
export const imageToolButton = (page: Page) => page.getByTestId('tool-image');

/* ------------------------------------------------------------------------- reading the board back */

/** One picture as the screen shows it. */
export interface ImageFace {
  id: string;
  /** What the box says it is doing: uploading, ready, failed, unfinished. */
  status: string;
  /** Whose upload it is, in the document; compared against this page's own identity. */
  uploader: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The words on the box: "Uploading…", "Upload failed", nothing when there is a picture. */
  text: string;
  /** True when there is an `<img>` and the browser has drawn it. */
  picture: boolean;
  /** The address the picture is asked for from, when there is one. */
  src: string | null;
}

const readFaces = `
  [...document.querySelectorAll('[data-image-object]')].map((element) => {
    const picture = element.querySelector('img');
    return {
      id: element.getAttribute('data-object-id') ?? '',
      status: element.getAttribute('data-status') ?? '',
      uploader: element.getAttribute('data-uploader') ?? '',
      x: Number.parseFloat(element.style.left),
      y: Number.parseFloat(element.style.top),
      width: Number.parseFloat(element.style.width),
      height: Number.parseFloat(element.style.height),
      text: (element.textContent ?? '').trim(),
      picture: picture !== null && picture.complete && picture.naturalWidth > 0,
      src: picture === null ? null : picture.getAttribute('src'),
    };
  })
`;

/** Every picture on this page's board, in the order the board draws them. */
export async function imageFaces(page: Page): Promise<ImageFace[]> {
  return page.evaluate(readFaces) as Promise<ImageFace[]>;
}

/** The pictures, sorted by where they were put: left to right, which is the order they were dropped. */
export async function imageFacesInOrder(page: Page): Promise<ImageFace[]> {
  const faces = await imageFaces(page);
  return faces.slice().sort((a, b) => a.x - b.x || a.y - b.y);
}

export async function imageFace(page: Page, id: string): Promise<ImageFace> {
  const faces = await imageFaces(page);
  const face = faces.find((candidate) => candidate.id === id);
  if (face === undefined) {
    throw new Error(`no picture with id ${id} on this board (saw ${describe(faces)})`);
  }
  return face;
}

/** The boxes the page that started the upload can still send again. */
export const retryButton = (page: Page, id: string) =>
  imageBox(page, id).getByTestId('image-retry');

/** The box that takes a picture off the board. */
export const removeButton = (page: Page, id: string) =>
  imageBox(page, id).getByTestId('image-remove');

export const imageBox = (page: Page, id: string) =>
  page.locator(`[data-image-object][data-object-id="${id}"]`);

/** The picture itself, once it is drawn. */
export const pictureOf = (page: Page, id: string) => imageBox(page, id).locator('img');

/**
 * Wait until this page shows `count` pictures, and say how long that took.
 *
 * The wait is the functional one - how many boxes are on the board is not a matter of timing - and the
 * timing is printed, because "the picture arrived" is a fact and "it arrived in eleven seconds" is a
 * different fact, and only the first one belongs in a pass/fail.
 */
export async function waitForImageCount(page: Page, count: number): Promise<ImageFace[]> {
  await expect
    .poll(() => imageFaces(page).then((faces) => faces.length), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [25, 50, 100],
      message: `the board should show ${count} pictures`,
    })
    .toBe(count);
  return imageFaces(page);
}

/** Wait until this page's board holds no pictures at all. */
export async function waitForNoImages(page: Page): Promise<void> {
  await expect
    .poll(() => imageFaces(page).then((faces) => faces.length), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      message: 'the board should be out of pictures',
    })
    .toBe(0);
}

/** Wait until one picture reaches a state, and hand back the box as it was then. */
export async function waitForImageStatus(
  page: Page,
  id: string,
  status: string,
): Promise<ImageFace> {
  await expect
    .poll(async () => (await imageFace(page, id)).status, {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [25, 50, 100],
      message: `picture ${id} should be ${status}`,
    })
    .toBe(status);
  return imageFace(page, id);
}

/** Wait until a picture is drawn - really drawn, by the browser, with pixels in it. */
export async function waitForPicture(page: Page, id: string): Promise<ImageFace> {
  // The poll answers in words rather than in booleans, because the difference between "not drawn yet" and
  // "not drawn, and the box says it failed" is the whole of this story, and a timeout that said only
  // "false" would leave a reader to guess which of the two it was.
  await expect
    .poll(() => describeWaiting(page, id), {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
      intervals: [25, 50, 100],
      message: `picture ${id} should be drawn on the page`,
    })
    .toBe('drawn');
  return imageFace(page, id);
}

/** Where the wait for a picture stands: either it is drawn, or what the box says about it. */
async function describeWaiting(page: Page, id: string): Promise<string> {
  const face = await imageFace(page, id);
  return face.picture
    ? 'drawn'
    : `not drawn (status ${face.status}, the box says "${face.text}", src ${face.src ?? 'nothing'})`;
}

/* ------------------------------------------------------------------------------------ the notices */

/** The refusal the board is showing, or null when it is showing nothing. */
export async function toastText(page: Page): Promise<string | null> {
  const toast = page.getByTestId('toast-message');
  return (await toast.count()) === 0 ? null : await toast.textContent();
}

/** Wait for a refusal that says exactly this, and take it off the screen again. */
export async function expectToast(page: Page, message: string): Promise<void> {
  await expect(page.getByTestId('toast-message'), `the board should say: ${message}`).toHaveText(
    message,
    { timeout: E2E_EVENTUAL_TIMEOUT_MS },
  );
  await dismissToast(page);
}

/** Click the notice away, so the next one can be told from this one. */
export async function dismissToast(page: Page): Promise<void> {
  const dismiss = page.getByTestId('toast-dismiss');
  if ((await dismiss.count()) > 0) {
    await dismiss.click();
  }
  await expect(page.getByTestId('toast-message')).toHaveCount(0, {
    timeout: E2E_EVENTUAL_TIMEOUT_MS,
  });
}

/** The blue frame that says "you can let go now", if it is up. */
export const dropHighlight = (page: Page) => page.getByTestId('drop-highlight');

/* ---------------------------------------------------------------------- making an upload be slow */

/**
 * Hold up this page's uploads by `ms`, without holding up anything else.
 *
 * An upload that finishes in six milliseconds is a good thing for a person and a bad thing for a test
 * that wants to see the state before it: the box would be there and gone between two reads. So the test
 * says "be slow" and the browser does the waiting, on the request itself - which is the honest way to do
 * it, because everything the board does in the meantime is its own work: the placeholder, the progress,
 * the other person's copy of the document, the picture when the bytes finally arrive. Nothing here tells
 * the client what state to be in.
 *
 * Only the POSTs are held. The GET that fetches a finished picture is a different request from a
 * different story, and delaying it would turn a wait for an upload into a wait for a download.
 */
/**
 * The address an upload goes to: `POST /api/boards/<boardId>/assets`.
 *
 * It is worth spelling out, because the address a *picture* comes from is a different shape altogether -
 * `/api/assets/<boardId>/<assetId>` - and a test that intercepts the one while meaning the other will sit
 * there, fully routed, fully unhurried, watching an upload fly past at full speed and conclude that the
 * board is broken. The two are deliberately unlike each other: the upload is to a board, and the picture is
 * from a key.
 */
const UPLOADS = '**/api/boards/*/assets';
const PICTURES = '**/api/assets/**';

export async function delayUploads(page: Page, ms: number): Promise<void> {
  await page.route(UPLOADS, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

/** Put this page's uploads back the way they were. */
export async function stopDelayingUploads(page: Page): Promise<void> {
  await page.unroute(UPLOADS);
}

/**
 * Refuse this page's uploads outright, the way a network does when it feels like it.
 *
 * The board is expected to notice, say so, and offer to send it again - which is a claim about a state a
 * fast, healthy connection never lets anyone see.
 */
export async function breakUploads(page: Page): Promise<void> {
  await page.route(UPLOADS, (route) => {
    if (route.request().method() === 'POST') {
      void route.abort('failed');
      return;
    }
    void route.continue();
  });
}

/** Let the uploads through again. */
export async function mendUploads(page: Page): Promise<void> {
  await page.unroute(UPLOADS);
}

/**
 * Make the address a picture comes from stop answering.
 *
 * This is how the board finds out that a picture it knows the address of is gone: not by being told, but by
 * the browser asking and getting nothing back. It is worth staging rather than reasoning about, because the
 * state it leads to - a ready object whose pixels will not draw - is one no amount of object-level state
 * can describe, and only the request can cause it.
 */
export async function losePictures(page: Page): Promise<void> {
  await page.route(PICTURES, (route) => {
    void route.fulfill({ status: 404, contentType: 'text/plain', body: 'no such picture' });
  });
}

/** The addresses start answering again. */
export async function bringPicturesBack(page: Page): Promise<void> {
  await page.unroute(PICTURES);
}

function describe(faces: readonly ImageFace[]): string {
  return faces.length === 0 ? 'nothing' : faces.map((face) => `${face.id}=${face.status}`).join(', ');
}
