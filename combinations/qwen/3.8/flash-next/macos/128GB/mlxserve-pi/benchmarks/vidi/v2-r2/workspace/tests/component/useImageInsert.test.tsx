// image.insert (ui-hook): the three doors a picture comes in through, and the one flow behind them.
//
// `useImageInsert` is given files by a drag, by a paste or by the file picker, and it is the place
// where the story's rules are either kept or broken: every door must apply the same rules, the box
// must appear before the bytes do, the bytes must arrive or fail in front of the person who sent
// them, and a board that cannot be reached must refuse the lot without writing anything down.
//
// Two things about the board below are not the board the address serves, and both are the test's
// rather than the app's:
//
//   * the room is mocked at `connectBoard`, so no socket is opened at a server that is not there.
//     The connection state the hook reads is still driven by `forceConnectionState`, which is
//     already how every other component test says what the room is doing;
//   * the board is rendered *with an address* (`BoardScreen boardId=...`), which `renderBoard()`
//     deliberately does not give it. Without an address there is nowhere to put a picture, and the
//     honest thing for the hook to do about that is refuse - which is a test below.
//
// The uploads are mocked one level above the wire (`uploadImage`), because what is under test is
// what the board writes while an upload is going on, not whether an `XMLHttpRequest` can report
// progress. Each mocked upload is handed to the test to finish by hand: progress, arrival and
// failure all happen exactly when the test says they do.
//
// Natural sizes come from a stubbed `createImageBitmap`, keyed by file name. It is the one part of
// a picture a test cannot invent - the placeholder is written from it - so a name that is not in
// the stub is a file this browser cannot decode, which is a state worth a test of its own.

import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  IMAGE_ACCEPTED_TYPES,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_STATUS_TICK_MS,
  IMAGE_TOAST_MS,
  IMAGE_UPLOAD_STALE_MS,
} from '../../src/shared/config';
import { initDoc } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { imageSnapshots, type ImageSnapshot } from '../../src/shared/objects/image';
import type { UploadResult } from '../../src/client/images/uploadImage';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { BoardScreen } from '../../src/client/pages/BoardPage';
import { pdfBytes, pngBytes } from '../fixtures/image-bytes';
import {
  boardSize,
  clickOn,
  dropHighlightEl,
  editorElement,
  fakeAssetKey,
  flushFrames,
  forceConnectionState,
  imageBox,
  imageCount,
  imageFileInput,
  imageNaturalOf,
  imagePicture,
  imageProgressOf,
  imageRemoveButton,
  imageRetryButton,
  imageSnapshotOf,
  imageSrcOf,
  imageStatusOf,
  imageWords,
  newNote,
  noteAt,
  pressKey,
  screenOf,
  toastTexts,
  useBoardTestLifecycle,
  viewportEl,
  worldOfScreen,
} from './helpers';

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** One upload the client asked for, with the means to finish it by hand. */
interface UploadCall {
  boardId: string;
  file: File;
  progress(fraction: number): void;
  resolve(result: UploadResult): void;
  abort(): void;
  aborted: boolean;
}

const state = vi.hoisted(() => ({
  uploads: [] as UploadCall[],
  boards: [] as string[],
  destroyed: 0,
}));

// The room, without a room: only the socket is mocked away, so `canUpload` is asked about a state
// the test chose rather than about a connection that would be failing on purpose. Everything the
// module also exports - `canEdit`, `canUpload`, the connection states - is the real thing.
vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: (_doc: Y.Doc, boardId: string) => {
      state.boards.push(boardId);
      return {
        drop: (): void => {},
        restore: (): void => {},
        awarenessPresent: (): boolean => false,
        reconnectAttempts: (): number => 0,
        destroy: (): void => {
          state.destroyed += 1;
        },
      };
    },
  };
});

// The upload, one level above the wire: pending until the test resolves it, and reporting only the
// progress it is told to report.
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (boardId: string, file: File, onProgress: (fraction: number) => void) => {
    let settle!: (result: UploadResult) => void;
    const promise = new Promise<UploadResult>((resolve) => {
      settle = resolve;
    });
    const call: UploadCall = {
      boardId,
      file,
      progress: onProgress,
      resolve: (result) => settle(result),
      abort: () => {
        call.aborted = true;
        settle({ kind: 'failed' });
      },
      aborted: false,
    };
    state.uploads.push(call);
    return { promise, abort: call.abort };
  },
}));

// --------------------------------------------------------------------------------
// The doors, as a browser opens them.
// --------------------------------------------------------------------------------

/**
 * The `DataTransfer` a drag or a paste carries. jsdom has no `DragEvent` that is also a mouse
 * event, and nothing in the client asks a transfer for more than `types` and `files`, so this is
 * all of it that any code reads.
 */
function transferOf(files: File[]): { types: string[]; files: File[] } {
  return { types: ['Files'], files };
}

/**
 * One drag event, built by hand.
 *
 * Testing-library hands a `dataTransfer` to a drag event and nothing else: what it is built from
 * has no room for a position, and a drop without a position is a drop whose picture has nowhere to
 * be put - it lands as `NaN` and the layout throws the box away. So where the drag is going is
 * written onto the event the way a browser writes it: `clientX`, `clientY`, and the point of it
 * all, `dataTransfer`.
 */
function fireDrag(kind: string, transfer: { types: string[]; files: File[] }, at?: Point): void {
  const event = new Event(kind, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  Object.defineProperty(event, 'clientX', { value: at?.x ?? 0 });
  Object.defineProperty(event, 'clientY', { value: at?.y ?? 0 });
  act(() => {
    viewportEl().dispatchEvent(event);
  });
}

/** A drag of something else entirely: a link, or selected text. */
function linkTransfer(): { types: string[]; files: File[] } {
  return { types: ['text/plain', 'text/uri-list'], files: [] };
}

/** Drag files onto the board and let go at a screen point. */
function dropFiles(files: File[], at: Point): void {
  const transfer = transferOf(files);
  fireDrag('dragenter', transfer, at);
  fireDrag('dragover', transfer, at);
  fireDrag('drop', transfer, at);
}

/** The same drag, stopped short of the drop. */
function dragFiles(files: File[]): void {
  const transfer = transferOf(files);
  fireDrag('dragenter', transfer);
  fireDrag('dragover', transfer);
}

function dragLeaves(files: File[]): void {
  fireDrag('dragleave', transferOf(files));
}

function dropTransfer(transfer: { types: string[]; files: File[] }, at: Point): void {
  fireDrag('dragenter', transfer, at);
  fireDrag('drop', transfer, at);
}

/** A paste into the window, which is where the board listens. */
function pasteFiles(files: File[], target: Element | Window = window): void {
  fireEvent.paste(target, { clipboardData: transferOf(files) });
}

/** Choose files in the hidden input, the way the system picker hands them back. */
function chooseFiles(files: File[]): void {
  const input = imageFileInput();
  if (input === null) throw new Error('chooseFiles: the board rendered no file input');
  const list = Object.assign(files, { item: (index: number) => files[index] ?? null });
  Object.defineProperty(input, 'files', { value: list, configurable: true });
  fireEvent.change(input);
}

/**
 * Let the chain an addition sets off run out: validate, decode, write, upload. It is all
 * microtasks - the mocked decoder resolves at once - so no timer is advanced and nothing else
 * about the board's clock moves.
 */
async function settled(): Promise<void> {
  await act(async () => {
    for (let round = 0; round < 12; round += 1) await Promise.resolve();
  });
}

/** The server took the picture. */
function finish(call: UploadCall, assetKey = fakeAssetKey()): void {
  act(() => {
    call.resolve({ kind: 'ok', assetKey });
  });
}

function fail(call: UploadCall, status?: number): void {
  const result: UploadResult = status === undefined ? { kind: 'failed' } : { kind: 'failed', status };
  act(() => {
    call.resolve(result);
  });
}

/** Report progress, the way an `XMLHttpRequest` does it mid-body. */
function report(call: UploadCall, fraction: number): void {
  act(() => {
    call.progress(fraction);
  });
}

// --------------------------------------------------------------------------------
// The board under test.
// --------------------------------------------------------------------------------

interface Board {
  doc: Y.Doc;
  boardId: string;
  unmount(): void;
}

/** The board as the address renders it: with an id of its own, so it has somewhere to send a picture. */
function renderAddressed(doc?: Y.Doc): Board {
  const boardDoc = doc ?? new Y.Doc();
  initDoc(boardDoc);
  const boardId = newBoardId();
  const utils = render(<BoardScreen doc={boardDoc} boardId={boardId} />);
  // The board measures itself once mounted (jsdom has no ResizeObserver, so it reports its size
  // through a data attribute); a camera is only meaningful after that.
  flushFrames();
  // The state a board that joined the room is in: everything can be done to it.
  forceConnectionState('connected');
  return { doc: boardDoc, boardId, unmount: () => act(() => utils.unmount()) };
}

/** The board on its own, with no address: what every other component test renders. */
function renderAddressless(doc?: Y.Doc): Board {
  const boardDoc = doc ?? new Y.Doc();
  initDoc(boardDoc);
  const utils = render(<BoardScreen doc={boardDoc} />);
  flushFrames();
  forceConnectionState('connected');
  return { doc: boardDoc, boardId: '', unmount: () => act(() => utils.unmount()) };
}

/** Files named the way a camera roll names them. */
function aFile(name: string, type = 'image/png', bytes: Uint8Array<ArrayBuffer> = pngBytes()): File {
  return new File([bytes], name, { type });
}

function imagesOf(doc: Y.Doc): readonly ImageSnapshot[] {
  return imageSnapshots(doc);
}

/** Which tool the toolbar says the pointer is in. */
function heldTool(): string | null {
  const pressed = Array.from(document.querySelectorAll<HTMLElement>('button[aria-pressed="true"]'));
  for (const button of pressed) {
    const id = button.dataset.testid ?? '';
    if (id.startsWith('tool-')) return id.slice('tool-'.length);
  }
  return null;
}

const dropPoint: Point = { x: 300, y: 200 };

/** The natural sizes this browser can decode. A name that is not here is not a picture to it. */
const decodable = new Map<string, Size>([
  ['a.png', { width: 400, height: 300 }],
  ['b.png', { width: 800, height: 600 }],
  ['c.png', { width: 1600, height: 1200 }],
  ['photo.jpg', { width: 600, height: 400 }],
  ['tall.png', { width: 300, height: 3200 }],
]);

beforeEach(() => {
  state.uploads = [];
  state.boards = [];
  state.destroyed = 0;
  vi.stubGlobal('createImageBitmap', (file: File) => {
    const size = decodable.get(file.name);
    if (size === undefined) return Promise.reject(new Error(`${file.name} is not a picture`));
    return Promise.resolve({
      width: size.width,
      height: size.height,
      close: (): void => {},
    } as unknown as ImageBitmap);
  });
});

useBoardTestLifecycle();

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('images dropped on the board', () => {
  it('TC-17 three files dropped become three placeholders in a row, and each one fills in', async () => {
    const { boardId } = renderAddressed();

    dropFiles([aFile('a.png'), aFile('b.png'), aFile('c.png')], screenOf(dropPoint));
    await settled();

    // Three boxes, before a single byte has left the tab.
    expect(imageCount()).toBe(3);
    expect(state.uploads.map((call) => call.file.name)).toEqual(['a.png', 'b.png', 'c.png']);
    expect(state.uploads.every((call) => call.boardId === boardId)).toBe(true);
    expect([imageStatusOf(0), imageStatusOf(1), imageStatusOf(2)]).toEqual([
      'uploading',
      'uploading',
      'uploading',
    ]);

    // A row to the right of where the files were let go, tops level, the gap between them.
    const first = imageBox(0);
    const second = imageBox(1);
    const third = imageBox(2);
    expect(first.x).toBeCloseTo(dropPoint.x, 4);
    expect(first.y).toBeCloseTo(dropPoint.y, 4);
    expect(second.x).toBeCloseTo(first.x + first.width + IMAGE_LAYOUT_GAP_WORLD, 4);
    expect(third.x).toBeCloseTo(second.x + second.width + IMAGE_LAYOUT_GAP_WORLD, 4);
    expect([second.y, third.y]).toEqual([first.y, first.y]);

    // Every box already has the proportions of the picture that will come: 1600x1200 came down to
    // 800x600 inside a 4:3 box.
    expect(first.width / first.height).toBeCloseTo(4 / 3, 6);
    expect(third.width).toBeCloseTo(800, 4);
    expect(third.height).toBeCloseTo(600, 4);

    // The percentage the person who dropped them sees - and each box its own number, not the
    // batch's: one upload a quarter of the way, two still at the start. The bar's value is on the
    // bar's own scale (`max=100`), so a quarter is 25 of them.
    report(state.uploads[0], 0.25);
    expect(imageProgressOf(0)).toBe(25);
    expect(imageWords(0)).toContain('25%');
    expect(imageProgressOf(1)).toBe(0);
    expect(imageWords(1)).toBe('0%');

    // And the pictures, when the bytes are taken.
    const keys = [fakeAssetKey(), fakeAssetKey(), fakeAssetKey()];
    state.uploads.forEach((call, index) => finish(call, keys[index]));
    await settled();
    expect([imageStatusOf(0), imageStatusOf(1), imageStatusOf(2)]).toEqual([
      'ready',
      'ready',
      'ready',
    ]);
    expect(imagePicture(0)).not.toBeNull();
    expect(imageSrcOf(0)).toBe(`/api/assets/${keys[0]}`);
    expect(imageProgressOf(0)).toBeNull();
    expect(imageWords(0)).toBe('');
  });

  it('TC-17 three placeholders are one thing to undo, and a late answer cannot put a picture back', async () => {
    const { doc } = renderAddressed();
    dropFiles([aFile('a.png'), aFile('b.png'), aFile('c.png')], screenOf(dropPoint));
    await settled();
    expect(imageCount()).toBe(3);

    pressKey('z', { ctrlKey: true });
    expect(imageCount()).toBe(0);

    // The uploads were in flight when the boxes were undone. Whatever the server answers now,
    // there is nothing left to mark ready.
    state.uploads.forEach((call) => finish(call));
    await settled();
    expect(imageCount()).toBe(0);
    expect(imagesOf(doc)).toEqual([]);
  });

  it('TC-18 a paste while a note is being typed into stays with the caret', async () => {
    const { doc } = renderAddressed();
    newNote(doc, { x: 0, y: 0 });
    clickOn(noteAt(0));
    pressKey('Enter');
    const editor = editorElement();
    expect(editor).not.toBeNull();

    pasteFiles([aFile('photo.jpg')], editor!);
    await settled();

    // The picture the clipboard carried belongs to the caret that was inside the note.
    expect(imageCount()).toBe(0);
    expect(state.uploads).toEqual([]);
    // Nothing was refused either: nothing went wrong.
    expect(toastTexts()).toEqual([]);
    expect(imagesOf(doc)).toEqual([]);
  });

  it('TC-18 a paste with the board in front of it puts the picture in the middle of what is in view', async () => {
    renderAddressed();

    pasteFiles([aFile('photo.jpg')]);
    await settled();

    expect(imageCount()).toBe(1);
    // In the middle of the visible board area, not of the world: the point the middle of the
    // screen is looking at, which is where a pasted picture is wanted.
    const view = boardSize();
    const centre = worldOfScreen({ x: view.width / 2, y: view.height / 2 });
    const box = imageBox(0);
    expect(box.x + box.width / 2).toBeCloseTo(centre.x, 4);
    expect(box.y + box.height / 2).toBeCloseTo(centre.y, 4);
    expect(box.width / box.height).toBeCloseTo(600 / 400, 6);
    expect(state.uploads).toHaveLength(1);
  });

  it('TC-19 a board that is reconnecting refuses the drop it is handed', async () => {
    const { doc } = renderAddressed();
    forceConnectionState('reconnecting');

    dropFiles([aFile('a.png')], screenOf(dropPoint));
    await settled();

    expect(toastTexts()).toEqual([REJECTION_MESSAGES.offline]);
    expect(imageCount()).toBe(0);
    expect(state.uploads).toEqual([]);
    expect(imagesOf(doc)).toEqual([]);
  });

  it('TC-19 a board that never loaded refuses it the same way, and writes nothing for the room to carry', async () => {
    const { doc } = renderAddressed();
    forceConnectionState('load_failed');

    dropFiles([aFile('a.png')], screenOf(dropPoint));
    await settled();

    expect(toastTexts()).toEqual([REJECTION_MESSAGES.offline]);
    expect(imageCount()).toBe(0);
    expect(state.uploads).toEqual([]);
    expect(imagesOf(doc)).toEqual([]);

    // The same file, once the room can be read again, is accepted.
    forceConnectionState('connected');
    dropFiles([aFile('a.png')], screenOf(dropPoint));
    await settled();
    expect(imageCount()).toBe(1);
  });

  it('TC-29 a file this browser cannot decode is told it is not a picture, and takes up no space', async () => {
    const { doc } = renderAddressed();

    // `corrupt.png` says it is a PNG - the type field is what validation reads - and its bytes say
    // otherwise, which is the second half of the same answer.
    dropFiles([aFile('corrupt.png'), aFile('a.png')], screenOf(dropPoint));
    await settled();

    expect(toastTexts()).toEqual([REJECTION_MESSAGES.type]);
    expect(imageCount()).toBe(1);
    expect(imageNaturalOf(0)).toEqual({ width: 400, height: 300 });
    expect(state.uploads.map((call) => call.file.name)).toEqual(['a.png']);
    expect(imagesOf(doc)).toHaveLength(1);
  });

  it('TC-26 a mixed batch says everything that is wrong with it and adds the one picture it can', async () => {
    const { doc } = renderAddressed();
    const tooBig = new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], 'huge.jpg', {
      type: 'image/jpeg',
    });

    chooseFiles([
      aFile('photo.jpg'),
      new File([pdfBytes()], 'drawing.png', { type: 'application/pdf' }),
      tooBig,
    ]);
    await settled();

    expect(toastTexts()).toEqual([REJECTION_MESSAGES.type, REJECTION_MESSAGES.size]);
    expect(imageCount()).toBe(1);
    expect(imageStatusOf(0)).toBe('uploading');
    expect(state.uploads.map((call) => call.file.name)).toEqual(['photo.jpg']);
    expect(imagesOf(doc)).toHaveLength(1);
  });

  it('TC-26 the picker offers the four types and takes as many as it is given, and leaves no tool behind', async () => {
    const { doc } = renderAddressed();
    const input = imageFileInput();
    expect(input).not.toBeNull();
    expect(input?.getAttribute('accept')).toBe(IMAGE_ACCEPTED_TYPES.join(','));
    expect(input?.multiple).toBe(true);
    // A control the person never tabs to: the toolbar button and the I key are the controls.
    expect(input?.getAttribute('aria-hidden')).toBe('true');
    expect(input?.tabIndex).toBe(-1);

    chooseFiles([aFile('tall.png')]);
    await settled();

    expect(imageCount()).toBe(1);
    // 300x3200: a tall picture stays tall, and comes down to the largest box it may be placed in.
    expect(imageBox(0).height).toBeCloseTo(800, 4);
    expect(imageBox(0).width).toBeCloseTo(75, 4);
    // Choosing the same file twice in a row is a second choice, so the value was cleared.
    expect(input?.value).toBe('');
    // The choice was made, so the pointer is back on Select: a picture is something done, not a
    // mode the pointer is put into.
    expect(heldTool()).toBe('select');
    expect(imagesOf(doc)).toHaveLength(1);
  });

  it('TC-24 an upload that failed is sent again from the same file, and the box says so while it goes', async () => {
    const { doc } = renderAddressed();
    dropFiles([aFile('a.png')], screenOf(dropPoint));
    await settled();

    fail(state.uploads[0], 500);
    await settled();
    expect(imageStatusOf(0)).toBe('failed');
    expect(imageWords(0)).toBe('Upload failed');
    expect(imageRetryButton(0)).not.toBeNull();

    fireEvent.click(imageRetryButton(0)!);
    await settled();

    expect(state.uploads).toHaveLength(2);
    expect(state.uploads[1].file.name).toBe('a.png');
    expect(imageStatusOf(0)).toBe('uploading');
    expect(imageProgressOf(0)).toBe(0);

    finish(state.uploads[1]);
    await settled();
    expect(imageStatusOf(0)).toBe('ready');
    expect(imageWords(0)).toBe('');
    expect(imagesOf(doc)).toHaveLength(1);
  });

  it('TC-24 the file a Retry needs lives in the tab that took it, and nowhere else', async () => {
    const board = renderAddressed();
    dropFiles([aFile('a.png')], screenOf(dropPoint));
    await settled();
    fail(state.uploads[0]);
    await settled();
    const id = imagesOf(board.doc)[0].id;
    expect(imageRetryButton(0)).not.toBeNull();

    // The tab goes away and comes back: the same document, the same failed box, no bytes left in
    // memory.
    state.uploads = [];
    board.unmount();
    renderAddressed(board.doc);

    // The failure outlived the reload - which is what the box is for.
    expect(imageStatusOf(0)).toBe('failed');
    expect(imageSnapshotOf(board.doc, id)?.status).toBe('failed');
    // The Retry does not, because there is nothing left to send: the new tab has never held the
    // file. (What a box with no file offers instead is tested in ImageObject.test.tsx.)
    expect(imageRetryButton(0)).toBeNull();
    expect(state.uploads).toEqual([]);
  });

  it('the clock says, in front of a board that has done nothing else, that an upload gave up', async () => {
    const { doc } = renderAddressed();
    dropFiles([aFile('a.png')], screenOf(dropPoint));
    await settled();

    expect(imageStatusOf(0)).toBe('uploading');
    expect(imageWords(0)).toBe('0%');

    // Five minutes of the clock ticking, and nothing else changing on the board.
    act(() => {
      vi.advanceTimersByTime(IMAGE_UPLOAD_STALE_MS + IMAGE_STATUS_TICK_MS);
    });

    expect(imageStatusOf(0)).toBe('unfinished');
    expect(imageWords(0)).toBe("Image upload didn't finish");
    expect(imageRemoveButton(0)).not.toBeNull();
    // What the document holds is still `uploading`: the box went stale on the clock, and the
    // upload was never written a lie about.
    expect(imageSnapshotOf(doc, imagesOf(doc)[0].id)?.status).toBe('uploading');
  });

  it('leaving the board stops what was going and writes nothing about it', async () => {
    const board = renderAddressed();
    dropFiles([aFile('a.png')], screenOf(dropPoint));
    await settled();
    const id = imagesOf(board.doc)[0].id;

    board.unmount();

    expect(state.uploads[0].aborted).toBe(true);
    // The placeholder is left exactly as it was: still `uploading`, which is what everybody else
    // will call unfinished in five minutes. Nothing was invented about it.
    expect(imageSnapshotOf(board.doc, id)?.status).toBe('uploading');
  });

  it('the board lights up for a drag of files, and stays dark for a drag of a link', () => {
    const { doc } = renderAddressed();
    const files = [aFile('a.png')];

    dragFiles(files);
    expect(dropHighlightEl()).not.toBeNull();
    // Crossing back over something it was hovering over is not leaving the board.
    dragLeaves(files);
    dragFiles(files);
    expect(dropHighlightEl()).not.toBeNull();
    dragLeaves(files);
    expect(dropHighlightEl()).toBeNull();

    // A link dragged from another tab is not the board's business at all: no light, no refusal.
    fireEvent.dragEnter(viewportEl(), { dataTransfer: linkTransfer() });
    fireEvent.dragOver(viewportEl(), { dataTransfer: linkTransfer() });
    expect(dropHighlightEl()).toBeNull();
    expect(toastTexts()).toEqual([]);

    // A drop that carries no pictures is left alone too, light and all; the drag that leaves is
    // what puts the light out.
    dragFiles(files);
    dropTransfer(linkTransfer(), screenOf(dropPoint));
    expect(dropHighlightEl()).not.toBeNull();
    expect(imageCount()).toBe(0);
    expect(toastTexts()).toEqual([]);
    dragLeaves(files);
    expect(dropHighlightEl()).toBeNull();
    expect(imagesOf(doc)).toEqual([]);
  });

  it('the Image button and the I key both open the picker, and neither holds a tool', () => {
    renderAddressed();
    const input = imageFileInput();
    const opened = vi.spyOn(input!, 'click');

    fireEvent.click(document.querySelector<HTMLElement>('[data-testid="tool-image"]')!);
    expect(opened).toHaveBeenCalledTimes(1);
    // The button took no tool: Select is still what the pointer is in.
    expect(heldTool()).toBe('select');

    pressKey('i');
    expect(opened).toHaveBeenCalledTimes(2);
    expect(heldTool()).toBe('select');
  });

  it('a toast says itself for four seconds and then stops saying it', async () => {
    renderAddressed();

    dropFiles([new File([pdfBytes()], 'plan.png', { type: 'application/pdf' })], screenOf(dropPoint));
    await settled();
    expect(toastTexts()).toEqual([REJECTION_MESSAGES.type]);

    act(() => {
      vi.advanceTimersByTime(IMAGE_TOAST_MS - 1);
    });
    expect(toastTexts()).toEqual([REJECTION_MESSAGES.type]);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(toastTexts()).toEqual([]);
  });

  it('a board with no address to send a picture to says it cannot, and writes nothing', async () => {
    // The board every other component test renders: no address, so nowhere for the bytes to go.
    const { doc } = renderAddressless();

    dropFiles([aFile('a.png')], screenOf(dropPoint));
    await settled();

    expect(toastTexts()).toEqual([REJECTION_MESSAGES.offline]);
    expect(imageCount()).toBe(0);
    expect(state.uploads).toEqual([]);
    expect(imagesOf(doc)).toEqual([]);
  });
});

export {};
