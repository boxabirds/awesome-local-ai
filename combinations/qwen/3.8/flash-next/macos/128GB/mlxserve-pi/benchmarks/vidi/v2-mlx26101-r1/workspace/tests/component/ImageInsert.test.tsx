// Story 12 — the three doors a picture comes in through (image.drop, image.paste, image.picker,
// image.uploading, image.offline, image.types, image.decode).
//
// The whole board is mounted, because what these stories are about is which door was opened and what
// the door did to the document: a drop has to become placeholders in *this* Y.Doc, in one undoable
// step, with one request per file, at the place the pointer was.
//
// Two things are standing in, and both are things a test cannot have. `uploadImage` is replaced with a
// wire the test holds the other end of, so "half the bytes have left" and "the server has answered"
// are things a test can say out loud. `createImageBitmap` is replaced per file name, because jsdom
// has no way to know what size a picture is — which is also how the file that is not a picture is
// made (image.types: a bad extension is not the only way to have a file that only claims to be one).

import { act, createEvent, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screenToWorld } from '../../src/client/canvas/camera';
import { readImage, type ImageSnap } from '../../src/shared/objects/image';
import { assetKeyFor, newAssetId } from '../../src/shared/image-format';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_FILES_PER_ADD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
} from '../../src/shared/config';
import { objectSnapshots } from '../../src/shared/board-model';
import {
  boardDoc,
  clickByRole,
  createNote,
  editTextObject,
  editorEl,
  readCamera,
  renderBoard,
  surface,
  windowKey,
} from './helpers';
import { lastProvider, resetProviderStub } from './y-websocket-stub';

/** One call the board made to the upload module, with the test's end of the wire attached to it. */
interface Wire {
  id: number;
  boardId: string;
  file: File;
  /** Say "this much of the file has left the tab". */
  sent: (fraction: number) => void;
  /** Say "the server has an answer". */
  answer: (result: unknown) => Promise<void>;
  /** Say "this tab has stopped caring", which is what an unmount does. */
  abort(): Promise<void>;
  aborted: boolean;
}

const wires: Wire[] = [];
/** How big the browser will claim each named file's pixels are. */
const bitmaps = new Map<string, { width: number; height: number; undecodable?: boolean }>();

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (boardId: string, file: File, onProgress: (fraction: number) => void) => {
    const id = wires.length;
    let settle: (result: unknown) => void = () => {};
    const promise = new Promise((resolve) => {
      settle = resolve;
    });
    const wire: Wire = {
      id,
      boardId,
      file,
      aborted: false,
      sent: (fraction) => {
        act(() => onProgress(fraction));
      },
      answer: async (result) => {
        await act(async () => {
          settle(result);
          // The board's side of the wire is a `.then` chain; one turn of the queue lets it land.
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      },
      abort: async () => {
        wire.aborted = true;
        await act(async () => {
          settle({ kind: 'failed', status: 0 });
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      },
    };
    wires.push(wire);
    return { promise, abort: () => void wire.abort() };
  },
}));

/** A file the board will take. */
function file(name: string, bytes = 1024, type = 'image/png'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** A file, plus the size the browser will report for it. */
function png(name: string, width: number, height: number): File {
  bitmaps.set(name, { width, height });
  return file(name);
}

/** A file whose bytes are not a picture, whatever the name claims (image.types). */
function undecodable(name: string): File {
  bitmaps.set(name, { width: 0, height: 0, undecodable: true });
  return file(name);
}

/** What a `DataTransfer` is to this board: a list of files and a word saying there are files. */
function fakeTransfer(files: File[]): Record<string, unknown> {
  return {
    files: Object.assign(files, { item: (at: number) => files[at] ?? null }),
    types: ['Files'],
    dropEffect: 'none',
  };
}

/**
 * Hand the board an event of one of these three kinds, at a screen point. The `dataTransfer` is put
 * on afterwards because jsdom has no `DataTransfer` to build one with; `files` and `types` are the
 * whole of the interface the board reads.
 */
function boardEvent(
  kind: 'drop' | 'dragover',
  el: HTMLElement,
  files: File[],
  at: [number, number],
): Record<string, unknown> {
  const transfer = fakeTransfer(files);
  const event =
    kind === 'drop'
      ? createEvent.drop(el, { clientX: at[0], clientY: at[1] })
      : createEvent.dragOver(el, { clientX: at[0], clientY: at[1] });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  fireEvent(el, event);
  return transfer;
}

function dropOn(el: HTMLElement, files: File[], at: [number, number] = [300, 200]): void {
  boardEvent('drop', el, files, at);
}

/** Drag files over the board: what the pointer's shape is decided by (image.drop). */
function dragOverBoard(el: HTMLElement, files: File[]): Record<string, unknown> {
  return boardEvent('dragover', el, files, [300, 200]);
}

/** Paste files, from whatever it was that put them there. */
function pasteInto(el: HTMLElement, files: File[]): void {
  const event = createEvent.paste(el);
  Object.defineProperty(event, 'clipboardData', { value: fakeTransfer(files) });
  fireEvent(el, event);
}

/** Drag files into the window, the way the browser does before a drop. */
function dragEnter(files: File[]): void {
  const event = new Event('dragenter', { bubbles: true });
  Object.defineProperty(event, 'dataTransfer', { value: fakeTransfer(files) });
  act(() => {
    window.dispatchEvent(event);
  });
}

/** ... and drag them out again. */
function dragLeave(): void {
  act(() => {
    window.dispatchEvent(new Event('dragleave', { bubbles: true }));
  });
}

/**
 * Say "the room is joined", which is what an upload needs before it is started (image.offline).
 *
 * `act` is not decoration here: a socket event that arrives outside it is a state change that has not
 * been rendered yet, and a drop dispatched in the same breath is handled by the board as it was
 * before the connection came back. A person leaves a longer gap than that.
 */
function connect(): void {
  const provider = lastProvider();
  if (!provider) throw new Error('the board never built a provider');
  act(() => {
    provider.emitSync(true);
  });
}

/** Lose it again, having had it: what a person calls "my board went grey". */
function reconnecting(): void {
  const provider = lastProvider();
  if (!provider) throw new Error('the board never built a provider');
  act(() => {
    provider.emitSync(false);
  });
}

/** Every picture on the board, in the order the document holds them. */
function images(): ImageSnap[] {
  return objectSnapshots(boardDoc()).filter((o): o is ImageSnap => o.type === 'image');
}

/** Where the world point under a screen point is — the camera is not at the origin (image.drop). */
function world(at: [number, number]): { x: number; y: number } {
  return screenToWorld(readCamera(), { x: at[0], y: at[1] });
}

/** What the board complained about, once per message, without the dismiss button's word in it. */
const toastText = (): string[] =>
  screen.queryAllByTestId('toast').map((el) => el.getAttribute('data-toast-text') ?? '');

/** Let the board's side of an asynchronous file read run to the end. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  resetProviderStub();
  wires.length = 0;
  bitmaps.clear();
  // jsdom's 1024×768 window is not the viewport the board is told it has. Making them agree means
  // "the middle of the view" has one answer for the code and for the test (image.paste).
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (input: File) => {
      const spec = bitmaps.get(input.name);
      if (!spec || spec.undecodable) throw new Error('the image bytes could not be decoded');
      return { width: spec.width, height: spec.height, close() {} };
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('dropping files on the board (TC-17)', () => {
  it('turns a drop of three files into three placeholders and three uploads', async () => {
    renderBoard();
    connect();

    dropOn(surface(), [png('a.png', 1200, 900), png('b.png', 1200, 900), png('c.png', 1200, 900)]);
    await settle();

    const made = images();
    expect(made).toHaveLength(3);
    expect(made.map((i) => i.status)).toEqual(['uploading', 'uploading', 'uploading']);
    // One request each, for this board, with the file itself in it.
    expect(wires.map((w) => [w.boardId, w.file.name])).toEqual([
      ['componenttestboard0004', 'a.png'],
      ['componenttestboard0004', 'b.png'],
      ['componenttestboard0004', 'c.png'],
    ]);
    // They arrive as a row starting under the pointer — top-left, left to right, a gap of 24 between
    // them that belongs to neither (image.drop) — each box already the size its picture will show at.
    const at = world([300, 200]);
    expect(made.map((i) => i.x)).toEqual([
      at.x,
      at.x + IMAGE_MAX_PLACE_SIZE_WORLD + IMAGE_LAYOUT_GAP_WORLD,
      at.x + 2 * (IMAGE_MAX_PLACE_SIZE_WORLD + IMAGE_LAYOUT_GAP_WORLD),
    ]);
    for (const image of made) {
      expect(image.y).toBe(at.y);
      expect([image.width, image.height]).toEqual([IMAGE_MAX_PLACE_SIZE_WORLD, 600]);
      expect(image.uploaderId).toBeTruthy();
      expect(image.uploadStartedAt).toBeGreaterThan(0);
    }
  });

  it('shrinks a big picture to the biggest box and leaves a small one alone', async () => {
    renderBoard();
    connect();

    dropOn(surface(), [png('huge.png', 6000, 3000), png('small.png', 20, 10)], [0, 0]);
    await settle();

    const [huge, small] = images();
    expect([huge.width, huge.height]).toEqual([IMAGE_MAX_PLACE_SIZE_WORLD, 400]);
    expect([small.width, small.height]).toEqual([20, 10]);
  });

  it('shows the percentage of an upload that is still in flight', async () => {
    renderBoard();
    connect();
    dropOn(surface(), [png('a.png', 1200, 900)]);
    await settle();

    const [image] = images();
    const box = screen.getByTestId(`image-object-${image.id}`);
    expect(within(box).getByText('Uploading…')).toBeTruthy();

    wires[0].sent(0.4);
    // The bar and the number are the same fact twice: once for the eye, once for whatever reads the
    // board without one.
    const bar = within(box).getByTestId(`image-progress-${image.id}`);
    expect(within(box).getByText('Uploading 40%')).toBeTruthy();
    expect(bar.getAttribute('aria-valuenow')).toBe('40');

    // Halfway through the bytes is not the end of them, so the bar follows the wire up.
    wires[0].sent(0.9);
    expect(within(box).getByText('Uploading 90%')).toBeTruthy();
    expect(bar.getAttribute('aria-valuenow')).toBe('90');

    await wires[0].answer({
      kind: 'ok',
      assetKey: 'componenttestboard0004/deadbeefcafebabe123456',
      contentType: 'image/png',
    });

    expect(readImage(boardDoc(), image.id)!.status).toBe('ready');
    // The stored picture is asked for by its own name, under this board's address (TC-20).
    expect(screen.getByTestId(`image-${image.id}`).getAttribute('src')).toBe(
      '/api/assets/componenttestboard0004/deadbeefcafebabe123456',
    );
    expect(screen.queryByTestId(`image-progress-${image.id}`)).toBeNull();
  });

  it('promises a copy, and puts a dashed frame around the board while files are over it', () => {
    renderBoard();
    connect();
    expect(screen.queryByTestId('drop-highlight')).toBeNull();

    dragEnter([file('a.png')]);
    const frame = screen.getByTestId('drop-highlight');
    // An outline rather than a fill: the pictures have to stay visible behind the frame aimed at.
    expect(frame.getAttribute('style')).toContain('dashed');

    // "This will become a new thing here" is what the pointer says while the frame is up, and it is
    // only said if the board says it (image.drop).
    expect(dragOverBoard(surface(), [file('a.png')]).dropEffect).toBe('copy');

    dragLeave();
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });

  it('takes all three placeholders back in one undo step', async () => {
    renderBoard();
    connect();
    dropOn(surface(), [png('a.png', 1200, 900), png('b.png', 1200, 900), png('c.png', 1200, 900)]);
    await settle();
    expect(images()).toHaveLength(3);

    fireEvent.click(screen.getByTestId('undo-button'));

    expect(images()).toHaveLength(0);
    // The uploads that were already in flight are left alone: nothing was waiting for them.
    expect(wires.every((w) => !w.aborted)).toBe(true);
  });
});

describe('paste and the picker (TC-18, TC-29)', () => {
  it('pastes a screenshot into the middle of the view', async () => {
    renderBoard();
    connect();

    pasteInto(surface(), [png('shot.png', 1600, 1000)]);
    await settle();

    const [image] = images();
    expect([image.width, image.height]).toEqual([800, 500]);
    // There is no pointer in a Cmd+V, so the box goes across the middle of what is on screen: the
    // world point under the middle of the window, with half a box on either side of it (image.paste).
    const centre = screenToWorld(readCamera(), { x: 1280 / 2, y: 800 / 2 });
    expect([image.x, image.y]).toEqual([centre.x - 400, centre.y - 250]);
    expect(wires).toHaveLength(1);
  });

  it('leaves a paste alone while a text field on the board has the caret', async () => {
    renderBoard();
    connect();
    const note = createNote(100, 100);
    editTextObject(note);
    // The premise: the caret is in a text field of the board, which is the one place where a paste
    // means "words".
    expect(editorEl().tagName).toBe('TEXTAREA');

    pasteInto(editorEl(), [png('shot.png', 1200, 900)]);
    await settle();

    // The screenshot the person may have meant for the note is not put anywhere, and nothing is
    // uploaded: a paste that was for words is not a request for a picture.
    expect(images()).toHaveLength(0);
    expect(wires).toHaveLength(0);
  });

  it('opens the file picker from the toolbar and from the I key, and holds no tool afterwards', () => {
    renderBoard();
    connect();
    const opens = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});

    clickByRole('Image (I)');
    expect(opens).toHaveBeenCalledTimes(1);

    windowKey('i');
    expect(opens).toHaveBeenCalledTimes(2);

    // A picture is not a tool: the board still holds Select afterwards, because a click on the board
    // after a picker means nothing (image.picker).
    expect(screen.getByTestId('select-tool').getAttribute('aria-pressed')).toBe('true');
    opens.mockRestore();
  });

  it('refuses a file the browser cannot open as a picture', async () => {
    renderBoard();
    connect();

    dropOn(surface(), [undecodable('lies.png')]);
    await settle();

    // The name said PNG, the bytes did not agree, and the bytes are what counts.
    expect(toastText()).toContain('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(images()).toHaveLength(0);
    expect(wires).toHaveLength(0);
  });

  it('says once what was wrong with a mixed drop and puts up only what was good', async () => {
    renderBoard();
    connect();

    dropOn(surface(), [file('doc.pdf', 1024, 'application/pdf'), png('a.png', 1200, 900)]);
    await settle();

    expect(toastText()).toEqual(['Only PNG, JPEG, GIF and WebP images can be added.']);
    expect(images()).toHaveLength(1);
    expect(wires).toHaveLength(1);
  });

  it('keeps the twenty-first picture of a drop off the board', async () => {
    renderBoard();
    connect();

    const names = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, at) => `p${at}.png`);
    for (const name of names) bitmaps.set(name, { width: 1200, height: 900 });
    dropOn(surface(), names.map((name) => file(name)));
    await settle();

    expect(images()).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(wires).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(toastText()).toContain('Only 20 images can be added at once.');
  });
});

describe('a board that cannot upload (TC-19)', () => {
  const OFFLINE = "You're offline — images can be added when you reconnect.";

  it('does not create a placeholder for a drop it cannot upload', async () => {
    renderBoard();
    connect();
    reconnecting();

    dropOn(surface(), [png('a.png', 1200, 900)]);
    await settle();

    expect(toastText()).toEqual([OFFLINE]);
    expect(images()).toHaveLength(0);
    expect(wires).toHaveLength(0);
  });

  it('does not open a file picker it cannot upload from', () => {
    renderBoard();
    connect();
    reconnecting();
    const opens = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});

    clickByRole('Image (I)');

    expect(opens).not.toHaveBeenCalled();
    expect(toastText()).toEqual([OFFLINE]);
    opens.mockRestore();
  });

  it('takes the picture again once the connection is back', async () => {
    renderBoard();
    connect();
    reconnecting();
    dropOn(surface(), [png('a.png', 1200, 900)]);
    await settle();
    expect(wires).toHaveLength(0);

    connect();
    dropOn(surface(), [png('a.png', 1200, 900)]);
    await settle();

    expect(wires).toHaveLength(1);
    expect(images()).toHaveLength(1);
    // The complaint from before the connection came back is still on screen — it was true when it was
    // said — but it was not said twice: the second drop was not refused.
    expect(toastText().filter((text) => text === OFFLINE)).toHaveLength(1);
  });
});

describe('which answer belongs to which picture (image.shared)', () => {
  // An upload's answer belongs to the file that asked for it, and to that object and nobody else's.
  //
  // Nothing in the document records which object came from which file: the boxes are laid out in a row,
  // the objects are read back in `z`-then-id order, and the uploads finish whenever the network feels
  // like it. So finishing three uploads in the order they started proves nothing about the pairing —
  // it would look right even if the answers had been handed out in a rotation. This answers them
  // backwards and reads the pairing off the one field in the document that came from the file itself:
  // the size its pixels decoded to.
  it('gives each picture the address its own file came back with, whichever answer arrived first', async () => {
    renderBoard();
    connect();

    bitmaps.set('small.webp', { width: 100, height: 100 });
    dropOn(surface(), [
      png('wide.png', 1200, 300),
      png('tall.png', 300, 1200),
      file('small.webp', 1024, 'image/webp'),
    ]);
    await settle();
    expect(wires.map((wire) => wire.file.name)).toEqual(['wide.png', 'tall.png', 'small.webp']);

    // The last file asked, and is the first one the server answers. Each answer is its own address.
    const boardId = wires[0]!.boardId;
    const keys = wires.map(() => assetKeyFor(boardId, newAssetId()));
    for (const index of [2, 0, 1]) {
      await wires[index]!.answer({ kind: 'ok', assetKey: keys[index] });
    }

    // Each box's shape is the shape its own file decoded to, which is as close as the document comes to
    // remembering which file this picture was — and the address written into it is that file's answer.
    const byShape = new Map(
      images().map((image) => [`${image.naturalWidth}x${image.naturalHeight}`, image]),
    );
    expect([...byShape.keys()].sort()).toEqual(['100x100', '1200x300', '300x1200']);
    expect(byShape.get('1200x300')!.assetKey, 'the wide one is the wide file').toBe(keys[0]);
    expect(byShape.get('300x1200')!.assetKey, 'the tall one is the tall file').toBe(keys[1]);
    expect(byShape.get('100x100')!.assetKey, 'and the small one got here first').toBe(keys[2]);
    expect(images().map((image) => image.status)).toEqual(['ready', 'ready', 'ready']);
    expect(
      new Set(images().map((image) => image.assetKey)).size,
      'three pictures, three addresses',
    ).toBe(3);
  });
});
