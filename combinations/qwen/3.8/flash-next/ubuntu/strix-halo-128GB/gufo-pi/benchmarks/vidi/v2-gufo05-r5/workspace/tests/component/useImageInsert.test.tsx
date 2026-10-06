/**
 * story 12 `image.insert` component tests (TC-17, TC-18, TC-19, TC-29).
 *
 * The whole board is rendered - real `Y.Doc`, real provider over the scripted socket, real
 * `useImageInsert` - and files are handed to it the way the browser hands them: a drop with a
 * DataTransfer, a paste with a clipboard. Two things are played, because a jsdom board can neither
 * transfer bytes nor decode a picture: `uploadImage`, so the test decides what the server did and when,
 * and `createImageBitmap`, so a file has dimensions.
 *
 * What is asserted is the promise, not the plumbing: three files dropped at a point become three
 * placeholders in a row at that point, the uploader sees their percentage, the ready image replaces the
 * placeholder; and nothing at all is added when there is no connection to add it over.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/dom';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { renderBoard } from './helpers';
import { FakeSocket, fakeWebSocket } from './fakeSocket';
import { screenToWorld } from '../../src/client/canvas/camera';
import { initDoc, type ImageSnapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';

/** One upload the test is holding the end of. */
interface PendingUpload {
  readonly file: File;
  /** Reports a fraction as if XHR's `upload.onprogress` had. */
  progress(fraction: number): void;
  succeed(assetKey: string): void;
  fail(): void;
}

/** One transfer the test is holding the end of. Types are erased, so hoisted code may name it. */
interface Row {
  file: File;
  onProgress: (fraction: number) => void;
  settle: (result: { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number }) => void;
}

const harness = vi.hoisted(() => {
  const rows: Row[] = [];
  return {
    rows,
    /** The dimensions the stubbed decoder answers with, per file name. */
    dimensions: new Map<string, { width: number; height: number }>(),
    /** File names whose bytes will not decode. */
    undecodable: new Set<string>(),
    reset() {
      rows.length = 0;
      this.dimensions.clear();
      this.undecodable.clear();
    },
  };
});

vi.mock('../../src/client/images/uploadImage', () => ({
  assetServeUrl: (key: string) => `/api/assets/${key}`,
  uploadImage: (
    _boardId: string,
    file: File,
    onProgress: (fraction: number) => void,
  ): { promise: Promise<unknown>; abort(): void } => {
    let settle: Row['settle'] = () => {};
    const promise = new Promise<unknown>((resolve) => {
      settle = resolve as Row['settle'];
    });
    harness.rows.push({ file, onProgress, settle });
    return { promise, abort: () => settle({ kind: 'failed' }) };
  },
}));

/** Every upload started so far, in order. */
function uploads(): PendingUpload[] {
  return harness.rows.map((row) => ({
    file: row.file,
    progress: (fraction: number) => row.onProgress(fraction),
    succeed: (assetKey: string) => row.settle({ kind: 'ok', assetKey }),
    fail: () => row.settle({ kind: 'failed', status: 500 }),
  }));
}

const ASSET_KEY = 'abcdefghijklmnopqrstuv/0123456789abcdefghijklmnopqr';

function doc(): Y.Doc {
  const hooks = window.__vidi6;
  if (!hooks) throw new Error('test hook window.__vidi6 is not registered');
  return hooks.getDoc();
}

function images(): ImageSnapshot[] {
  return (window.__vidi6?.getObjects() ?? []).filter(
    (object): object is ImageSnapshot => object.type === 'image',
  );
}

/** Lets the add's awaits run: decode, then layout, then the write, then the upload start. */
async function settlePromises(rounds = 6): Promise<void> {
  await act(async () => {
    for (let index = 0; index < rounds; index += 1) await Promise.resolve();
  });
}

function fileOf(name: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

/** A `drop` carrying files, at a point on the board. jsdom has no DragEvent or DataTransfer. */
function dropFiles(files: File[], point: { x: number; y: number }): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: { files, types: ['Files'], dropEffect: 'copy' } },
    clientX: { value: point.x },
    clientY: { value: point.y },
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

/** A `paste` whose clipboard carries files. */
function pasteFiles(files: File[], target: EventTarget): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { files, items: [] } });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/** The board, over a wire that is up and a room that answered. */
async function renderConnectedBoard(): Promise<void> {
  const room = new Y.Doc();
  initDoc(room);
  vi.stubGlobal('WebSocket', fakeWebSocket);
  renderBoard();
  act(() => {
    FakeSocket.latest.open();
    FakeSocket.latest.syncWith(room);
  });
  await waitFor(() => {
    const state = window.__vidi6?.connectionState();
    expect(state === 'connected' || state === 'confirmed').toBe(true);
  });
}

beforeEach(() => {
  FakeSocket.reset();
  harness.reset();
  vi.stubGlobal('createImageBitmap', async (input: File) => {
    if (harness.undecodable.has(input.name)) throw new Error('cannot decode');
    const size = harness.dimensions.get(input.name) ?? { width: 400, height: 300 };
    return { width: size.width, height: size.height, close() {} };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image.insert.drop', () => {
  // TC-17: three files dropped at a point become three placeholders in a row at that point, the
  // uploader's showing progress, and each fills in when its own upload answers.
  test('TC-17 three files dropped become a row of placeholders that fill in as they upload', async () => {
    await renderConnectedBoard();
    harness.dimensions.set('a.png', { width: 400, height: 300 });
    harness.dimensions.set('b.png', { width: 200, height: 400 });
    harness.dimensions.set('c.png', { width: 800, height: 200 });
    const point = { x: 300, y: 200 };

    dropFiles([fileOf('a.png'), fileOf('b.png'), fileOf('c.png')], point);
    await settlePromises();

    const placed = images();
    expect(placed).toHaveLength(3);
    const from = screenToWorld(window.__vidi6!.getCamera(), point);
    // the first box's top-left corner is where the file was let go, the rest follow left to right
    expect(placed[0]!.x).toBeCloseTo(from.x, 5);
    expect(placed[0]!.y).toBeCloseTo(from.y, 5);
    expect(placed[1]!.x).toBeCloseTo(placed[0]!.x + placed[0]!.width + IMAGE_LAYOUT_GAP_WORLD, 5);
    expect(placed[1]!.y).toBeCloseTo(placed[0]!.y, 5);
    expect(placed[2]!.x).toBeCloseTo(placed[1]!.x + placed[1]!.width + IMAGE_LAYOUT_GAP_WORLD, 5);
    // one pixel of the file is one board unit
    expect(placed[0]!.width).toBe(400);
    expect(placed[2]!.width).toBe(800);
    expect(placed.map((image) => image.status)).toEqual(['uploading', 'uploading', 'uploading']);
    expect(document.querySelectorAll('[data-image-object]')).toHaveLength(3);

    // the uploader's placeholder carries the transfer's percentage
    expect(uploads()).toHaveLength(3);
    act(() => uploads()[0]!.progress(0.4));
    await settlePromises(2);
    expect(screen.getByTestId('image-progress')).toHaveTextContent('40%');

    act(() => uploads()[0]!.succeed(ASSET_KEY));
    await settlePromises(2);

    expect(images()[0]!.status).toBe('ready');
    expect(images()[0]!.assetKey).toBe(ASSET_KEY);
    expect(screen.getByTestId('image-picture')).toHaveAttribute('src', `/api/assets/${ASSET_KEY}`);
    // the other two are still on their way, and still placeholders
    expect(images()[1]!.status).toBe('uploading');
    expect(screen.getAllByTestId('image-uploading')).toHaveLength(2);
  });
});

describe('image.insert.paste', () => {
  // TC-18: the board owns a paste only while nobody is writing text. A paste into a note that is
  // being edited stays a paste into that note, and adds nothing.
  test('TC-18 pasting an image into a note being edited adds no image', async () => {
    await renderConnectedBoard();
    let noteId = '';
    await act(() => {
      noteId = window.__vidi6!.createNote(0, 0);
    });
    const note = document.querySelector<HTMLElement>(`[data-note-id="${noteId}"]`);
    if (!note) throw new Error('the note was not rendered');
    fireEvent.doubleClick(note, { clientX: 200, clientY: 200 });
    await settlePromises(2);
    const editor = document.querySelector<HTMLTextAreaElement>('textarea');
    if (!editor) throw new Error('the note editor did not open');

    pasteFiles([fileOf('shot.png')], editor);
    await settlePromises();

    expect(images()).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
    // the editor still has the focus it was given, which is what the paste belongs to
    expect(document.activeElement).toBe(editor);
  });

  // TC-18, the other half: with the board itself focused, the pasted image lands in the middle of
  // what the person can see.
  test('TC-18 pasting an image with the board focused centres it in the view', async () => {
    await renderConnectedBoard();
    harness.dimensions.set('shot.png', { width: 600, height: 400 });

    pasteFiles([fileOf('shot.png')], document.body);
    await settlePromises();

    const placed = images();
    expect(placed).toHaveLength(1);
    const centre = screenToWorld(window.__vidi6!.getCamera(), {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    expect(placed[0]!.x + placed[0]!.width / 2).toBeCloseTo(centre.x, 5);
    expect(placed[0]!.y + placed[0]!.height / 2).toBeCloseTo(centre.y, 5);
    expect(uploads()).toHaveLength(1);
  });
});

describe('image.insert.offline', () => {
  // TC-19: an add needs a connection that can carry it. Nothing is written and nothing is sent; the
  // person is told, in the words the PRD fixes.
  test('TC-19 dropping a file while reconnecting says so and adds nothing', async () => {
    await renderConnectedBoard();
    act(() => {
      FakeSocket.latest.close(1006, 'gone');
    });
    await waitFor(() => expect(window.__vidi6?.connectionState()).toBe('reconnecting'));

    dropFiles([fileOf('a.png')], { x: 300, y: 200 });
    await settlePromises();

    expect(screen.getByTestId('board-toast')).toHaveTextContent(REJECTION_MESSAGES.offline);
    expect(images()).toHaveLength(0);
    expect(document.querySelectorAll('[data-image-object]')).toHaveLength(0);
    expect(uploads()).toHaveLength(0);
    expect(doc().getMap('objects').size).toBe(0);
  });

  // The Image button is the same answer while offline, and does not open a dialog to fail in.
  test('TC-19 the Image button while offline says so and opens no picker', async () => {
    await renderConnectedBoard();
    act(() => {
      FakeSocket.latest.close(1006, 'gone');
    });
    await waitFor(() => expect(window.__vidi6?.connectionState()).toBe('reconnecting'));

    fireEvent.click(screen.getByTestId('add-image-button'));
    await settlePromises(2);

    expect(screen.getByTestId('board-toast')).toHaveTextContent(REJECTION_MESSAGES.offline);
    expect(document.querySelector('input[data-image-file-picker]')).toBeNull();
    expect(images()).toHaveLength(0);
  });

  // The picker: files chosen by the system are added centred in view, the same as a paste.
  test('TC-19 the Image button opens a picker filtered to the four types', async () => {
    await renderConnectedBoard();

    fireEvent.click(screen.getByTestId('add-image-button'));
    await settlePromises(2);

    const input = document.querySelector<HTMLInputElement>('input[data-image-file-picker]');
    expect(input).not.toBeNull();
    expect(input!.multiple).toBe(true);
    expect(input!.accept).toBe('image/png,image/jpeg,image/gif,image/webp');

    Object.defineProperty(input, 'files', { value: [fileOf('picked.png')] });
    act(() => {
      input!.dispatchEvent(new Event('change'));
    });
    await settlePromises();

    expect(images()).toHaveLength(1);
    expect(uploads()[0]!.file.name).toBe('picked.png');
  });
});

describe('image.insert.decode', () => {
  // TC-29: a file that says it is a PNG and will not decode is refused with the type message, and the
  // rest of the drop is still added.
  test('TC-29 a file that will not decode is refused with the type message', async () => {
    await renderConnectedBoard();
    harness.undecodable.add('corrupt.png');

    dropFiles([fileOf('corrupt.png'), fileOf('good.png')], { x: 100, y: 100 });
    await settlePromises();

    expect(screen.getByTestId('board-toast')).toHaveTextContent(REJECTION_MESSAGES.type);
    const placed = images();
    expect(placed).toHaveLength(1);
    expect(placed[0]!.naturalWidth).toBe(400);
    expect(uploads()).toHaveLength(1);
  });

  // A wrong-type file never reaches the decoder at all: the toast says which half of the batch was
  // refused, and the supported one is added.
  test('TC-29 a PDF in the same drop is refused by type and the PNG is still added', async () => {
    await renderConnectedBoard();

    dropFiles(
      [new File([new Uint8Array(64)], 'notes.pdf', { type: 'application/pdf' }), fileOf('good.png')],
      { x: 100, y: 100 },
    );
    await settlePromises();

    expect(screen.getByTestId('board-toast')).toHaveTextContent(REJECTION_MESSAGES.type);
    expect(images()).toHaveLength(1);
  });

  // The drop highlight answers a file drag, and only a file drag.
  test('the board lights up while a file is being dragged over it, and not for a drag of its own', async () => {
    await renderConnectedBoard();
    expect(document.querySelector('[data-testid="drop-highlight"]')).toBeNull();

    const enter = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.defineProperty(enter, 'dataTransfer', { value: { files: [], types: ['Files'] } });
    act(() => {
      window.dispatchEvent(enter);
    });
    expect(document.querySelector('[data-testid="drop-highlight"]')).not.toBeNull();

    const leave = new Event('dragleave', { bubbles: true, cancelable: true });
    Object.defineProperty(leave, 'dataTransfer', { value: { files: [], types: ['Files'] } });
    act(() => {
      window.dispatchEvent(leave);
    });
    expect(document.querySelector('[data-testid="drop-highlight"]')).toBeNull();

    // a drag of board content carries no files, and says nothing about images
    const internal = new Event('dragenter', { bubbles: true, cancelable: true });
    Object.defineProperty(internal, 'dataTransfer', { value: { files: [], types: [] } });
    act(() => {
      window.dispatchEvent(internal);
    });
    expect(document.querySelector('[data-testid="drop-highlight"]')).toBeNull();
  });

  // A failed transfer leaves the uploader's placeholder offering Retry, and the same file goes again.
  test('a failed upload is retried with the same file', async () => {
    await renderConnectedBoard();

    dropFiles([fileOf('a.png')], { x: 100, y: 100 });
    await settlePromises();
    act(() => uploads()[0]!.fail());
    await settlePromises(2);

    expect(images()[0]!.status).toBe('failed');
    expect(screen.getByTestId('image-failed')).toHaveTextContent('Upload failed');

    fireEvent.click(screen.getByTestId('image-retry'));
    await settlePromises();

    expect(images()[0]!.status).toBe('uploading');
    expect(uploads()).toHaveLength(2);
    expect(uploads()[1]!.file.name).toBe('a.png');

    act(() => uploads()[1]!.succeed(ASSET_KEY));
    await settlePromises(2);
    expect(images()[0]!.status).toBe('ready');
  });


});
