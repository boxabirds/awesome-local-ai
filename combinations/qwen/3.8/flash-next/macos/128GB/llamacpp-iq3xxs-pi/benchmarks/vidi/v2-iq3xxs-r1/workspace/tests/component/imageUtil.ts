import { act, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { FIXTURE_DIMENSIONS, fixtureFile, type ImageFixture } from '../fixtures/images';
import { initDoc } from '../../src/shared/board-model';
import {
  createImagePlaceholders,
  imageSnapshots,
  layoutRow,
  type PlacementItem,
} from '../../src/shared/objects/image';
import { getCamera } from './util';
import { hook } from './stickyUtil';
import { screenToWorld } from '../../src/client/canvas/camera';
import type { Point } from '../../src/shared/geometry';
import type { ImageSnap } from '../../src/shared/objects/image';

/**
 * Driving the three doors (drop, paste, picker) in jsdom.
 *
 * jsdom has neither `DataTransfer` that carries files, nor image decoding, so the two
 * things a browser hands these flows — a drag's `dataTransfer` and a decoded bitmap —
 * are supplied here: the first as plain objects on a real event, the second as a stub
 * that answers with what Chromium answers for the same fixture bytes (checked with
 * `tests/fixtures/images`: a truncated PNG and everything that is not an image fail
 * `createImageBitmap`, and only the truncated one still loads in an `<img>`).
 */

/* ------------------------------------------------------------------ the board */

export function boardEl(): HTMLElement {
  return screen.getByTestId('board');
}

/** The image boxes on the screen, in paint order — none at all is a possible answer. */
export function imageEls(): HTMLElement[] {
  return screen.queryAllByTestId('image-object');
}

export function imageEl(index = 0): HTMLElement {
  return imageEls()[index]!;
}

export function imageStatus(index = 0): string {
  return screen.getAllByTestId('image-status')[index]!.textContent ?? '';
}

/** The board's image objects, straight from the document. */
export function imageSnaps(): readonly ImageSnap[] {
  return hook().getImages();
}

export function snapOf(image: HTMLElement): ImageSnap {
  const id = image.dataset.imageId!;
  const found = imageSnaps().find((img) => img.id === id);
  if (!found) throw new Error(`image ${id} is on the screen but not in the document`);
  return found;
}

/** What the toasts say, in the order they appeared (none at all is a fine answer). */
export function toastTexts(): string[] {
  return screen.queryAllByTestId('toast').map((el) => el.textContent ?? '');
}

/* ------------------------------------------------------------------- the doors */

/** A `dataTransfer` with what these flows read out of it. */
function transfer(files: readonly File[]): {
  files: File[];
  types: string[];
  dropEffect: string;
  effectAllowed: string;
} {
  return { files: [...files], types: files.length > 0 ? ['Files'] : [], dropEffect: 'none', effectAllowed: 'copy' };
}

function dispatchOn(target: EventTarget & Element, type: string, extra: Record<string, unknown>): Event {
  // jsdom builds no DragEvent from a dataTransfer, and the handlers only ever read the
  // three fields a browser would fill in, so a plain event carrying them is honest.
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, extra);
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** A file drag that has reached the board — the highlight's cue, and `dragover`'s. */
export function dragFilesOnto(files: readonly File[], at: Point = { x: 120, y: 140 }): void {
  const el = boardEl();
  dispatchOn(el, 'dragenter', { dataTransfer: transfer(files), clientX: at.x, clientY: at.y });
  dispatchOn(el, 'dragover', { dataTransfer: transfer(files), clientX: at.x, clientY: at.y });
}

/** The same drag leaving again. */
export function dragFilesAway(files: readonly File[], at: Point = { x: 120, y: 140 }): void {
  dispatchOn(boardEl(), 'dragleave', { dataTransfer: transfer(files), clientX: at.x, clientY: at.y });
}

/** Let go over the board. The default point is well inside the top-left corner. */
export function dropFiles(files: readonly File[], at: Point = { x: 120, y: 140 }): Event {
  const el = boardEl();
  return dispatchOn(el, 'drop', { dataTransfer: transfer(files), clientX: at.x, clientY: at.y });
}

/** The drop point, where the first image's top-left corner will land, in world space. */
export function dropTargetInWorld(at: Point = { x: 120, y: 140 }): Point {
  return screenToWorld(getCamera(), at);
}

/**
 * Paste onto the board. `target` is where the keyboard is: a note being edited is an
 * element, and the paste belongs to it (PRD image.paste).
 */
export function pasteFiles(files: readonly File[], target?: Element): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.assign(event, {
    // `clipboardData` is read-only on a real ClipboardEvent and cannot be given to one,
    // and this is what the handler looks at.
    clipboardData: transfer(files),
  });
  act(() => {
    // It reaches the board as a window event however far down it started.
    (target ?? window).dispatchEvent(event);
  });
  return event;
}

/* -------------------------------------------------------------- image decoding */

/**
 * Fixtures Chromium's decoder refuses. `corrupt.png` is truncated: an `<img>` still
 * reports its header's size, but `createImageBitmap` answers `InvalidStateError`, which
 * is the difference between a broken picture on the board and a file that was never a
 * picture. Verified against Chromium; the loader's `FIXTURE_DIMENSIONS` records the
 * `<img>` behaviour, which the error box about a stored image depends on.
 */
const UNDECODABLE: readonly ImageFixture[] = ['corrupt.png', 'document.pdf', 'fake.png', 'script.svg'];

/** Put `createImageBitmap`'s absence right, for the flows that measure a file. */
export function installImageBitmapStub(): void {
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    writable: true,
    value: async (file: Blob & { name?: string }) => {
      const name = file.name ?? '';
      const dimensions = FIXTURE_DIMENSIONS[name as ImageFixture];
      if (UNDECODABLE.includes(name as ImageFixture)) {
        throw new Error(`InvalidStateError: The source image could not be decoded. (${name})`);
      }
      if (!dimensions) throw new Error(`unknown fixture in createImageBitmap stub: ${name}`);
      return {
        width: dimensions.width,
        height: dimensions.height,
        close(): void {},
      } as unknown as ImageBitmap;
    },
  });
}

/* --------------------------------------------------------------------- clocks */

/**
 * `Date.now()` for the whole test, advanced by hand. The stale-upload cases are about a
 * difference of `IMAGE_UPLOAD_STALE_MS`, and a test that waits five real minutes is not
 * a test.
 */
export function fixedClock(start = 1_700_000_000_000): {
  now(): number;
  advance(ms: number): void;
  install(): void;
  uninstall(): void;
} {
  let current = start;
  const real = Date.now;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
    install() {
      Date.now = () => current;
    },
    uninstall() {
      Date.now = real;
    },
  };
}

/* ------------------------------------------------------- objects in a document */

/** Several fixtures as files, in the order asked for. */
export async function fixtures(...names: ImageFixture[]): Promise<File[]> {
  return Promise.all(names.map((name) => fixtureFile(name)));
}

/**
 * One image's worth of placement items, as a drop of one 300x200 file would produce,
 * near the origin. Enough to make a real object without a browser in the way.
 */
export function oneItem(uploaderId: string): { items: PlacementItem[]; uploader: string } {
  const sizes = [{ width: 300, height: 200 }];
  const rects = layoutRow(sizes, { x: 20, y: 20 }, 'top-left');
  return {
    items: rects.map((rect, i) => ({
      rect,
      naturalWidth: sizes[i]!.width,
      naturalHeight: sizes[i]!.height,
      contentType: 'image/png',
    })),
    uploader: uploaderId,
  };
}

/**
 * A document holding exactly one image object, in the state `mutate` asks for — the
 * way a test that is only about one box gets a real snapshot rather than an invented one.
 */
export function oneImage(
  mutate: (doc: Y.Doc, id: string) => void = () => {},
  uploaderId = 'leo',
): { doc: Y.Doc; snap: ImageSnap } {
  const doc = new Y.Doc();
  initDoc(doc);
  const { items, uploader } = oneItem(uploaderId);
  const [id] = createImagePlaceholders(doc, items, uploader, 1_700_000_000_000);
  mutate(doc, id!);
  const snap = imageSnapshots(doc)[0];
  if (!snap) throw new Error('the document has no image after being asked for one');
  return { doc, snap };
}

/**
 * Put one image object on a board's document as though some other tab had started it at
 * `startedAt` — the way to end up with an upload that is old, or failed, without having
 * to live through it. The document change happens inside `act`, so the board has seen it
 * by the time the call returns.
 */
export function createOneImagePlaceholder(doc: Y.Doc, uploaderId: string, startedAt: number): string {
  const { items } = oneItem(uploaderId);
  let id = '';
  act(() => {
    id = createImagePlaceholders(doc, items, uploaderId, startedAt)[0]!;
  });
  return id;
}
