// Story 12 task 8 — the ways a picture arrives, on a real board with a fake network.
//
// What is mounted is the real `BoardApp` on a real `Y.Doc`, because what is under test is how a
// drop, a paste and a file picker reach the document: the row the placeholders land in, which of
// three files is refused and said out loud, what the box says while the bytes are on their way and
// what it says afterwards. A probe component calling the hook directly would test the hook and miss
// the board.
//
// The one thing that is not real is the upload. `uploadImage` is replaced with a mock that hands
// back the handle it created, so a test decides when 41% has been handed to the network, when the
// server answered 201 and when it answered 429 — the three moments a box changes its mind.
// Everything else, including reading a file's bytes and asking whether it opens as a picture, is
// the browser's own machinery — with `createImageBitmap` stubbed, because jsdom has no decoder and
// a test may not pretend otherwise.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import type { ConnectionState } from '../../src/client/board/ConnectionStatus.tsx';
import { initDoc, objectSnapshots, type ObjectSnapshot } from '../../src/shared/board-model.ts';
import { newBoardId } from '../../src/shared/board-id.ts';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_PLACE_SIZE_WORLD } from '../../src/shared/config.ts';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles.ts';
import { clearToasts, getToasts } from '../../src/client/ui/Toast.tsx';
import { imageFile, oversizedImageFile } from '../fixtures/images/files.ts';
import { IMAGE_MAX_BYTES } from '../../src/shared/config.ts';

/** What the server can answer about a file that was sent to it. */
type UploadAnswer =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status?: number };

/** One upload the test is holding the other end of. */
interface MockUpload {
  boardId: string;
  file: File;
  /** Say that this much of the file has been handed to the network. */
  progress(fraction: number): void;
  /** Say what the server answered. */
  answer(result: UploadAnswer): void;
  readonly aborted: boolean;
}

interface UploadMock {
  calls: MockUpload[];
  reset(): void;
}

// The mock is built before the module graph loads (`vi.hoisted`): the module it stands in for is
// imported by a hook the board imports, and a mock that arrived after would be a mock of a module
// somebody had already read.
const uploadMock = vi.hoisted(() => {
  const calls: unknown[] = [];
  return {
    calls,
    reset() {
      calls.length = 0;
    },
    uploadImage(boardId: string, file: File, onProgress: (fraction: number) => void) {
      let answer!: (result: UploadAnswer) => void;
      const promise = new Promise<UploadAnswer>((resolve) => {
        answer = resolve;
      });
      const call = {
        boardId,
        file,
        progress: (fraction: number) => onProgress(fraction),
        answer: (result: UploadAnswer) => answer(result),
        aborted: false,
      };
      calls.push(call);
      return {
        promise,
        abort: () => {
          call.aborted = true;
        },
      };
    },
  };
});

vi.mock('../../src/client/images/uploadImage.ts', () => ({
  uploadImage: uploadMock.uploadImage,
}));

const uploads = uploadMock as unknown as UploadMock;

let doc: Y.Doc;
let boardId: string;
let app: HTMLElement;

/**
 * The pictures on the board, left to right — which for a row is the order they were added.
 *
 * A Y.Map is iterated in key order and the keys are random ids, so a test that wants the first
 * file of a row asks for the leftmost box instead of trusting the document's arithmetic.
 */
function images(): ObjectSnapshot[] {
  return objectSnapshots(doc)
    .filter((obj) => obj.type === 'image')
    .sort((a, b) => a.x - b.x);
}

/**
 * A box's geometry, with the two fields a test is about to compare known to be there.
 *
 * They are optional on a snapshot because an object written by a build that came after this one
 * may hold a box whose size nobody recorded; a test that read them as though they were always
 * there would pass on `undefined`, which is not a size.
 */
function geometryOf(obj: ObjectSnapshot): { x: number; y: number; width: number; height: number } {
  if (obj.width === undefined || obj.height === undefined) {
    throw new Error('the box has no size on the board');
  }
  return { x: obj.x, y: obj.y, width: obj.width, height: obj.height };
}

function imageById(id: string): ObjectSnapshot | undefined {
  return images().find((obj) => obj.id === id);
}

function mountBoard(connection: ConnectionState = 'connected'): HTMLElement {
  doc = new Y.Doc();
  initDoc(doc);
  render(<BoardApp doc={doc} boardId={boardId} connection={connection} />);
  return screen.getByTestId('app');
}

/**
 * A file being dragged.
 *
 * jsdom has no `DataTransfer`, which is only possible because the board asks a drag the questions
 * a `DataTransfer` answers — what types it carries, what files, and where the pointer is — and
 * nothing else.
 */
function fileTransfer(files: File[]) {
  return {
    types: files.length > 0 ? ['Files'] : [],
    files,
    items: [],
    dropEffect: 'none',
    effectAllowed: 'all',
    getData: () => '',
    setData: () => {},
  };
}

/** One moment of a drag, as the browser would send it. */
function dragEvent(
  type: 'dragenter' | 'dragover' | 'dragleave' | 'drop',
  files: File[],
  at?: { x: number; y: number },
  relatedTarget?: Node | null,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    dataTransfer: fileTransfer(files),
    clientX: at?.x ?? 0,
    clientY: at?.y ?? 0,
    relatedTarget: relatedTarget ?? null,
  });
  // `act`, because a drag is what makes the board show and hide a frame: the state change it
  // causes has to be given the chance to reach the screen before the test looks.
  act(() => {
    app.dispatchEvent(event);
  });
  return event;
}

/** A file arriving the way a file arrives: entered, over, and dropped at a point. */
function dropFiles(files: File[], at: { x: number; y: number } = { x: 300, y: 200 }): void {
  dragEvent('dragenter', files);
  dragEvent('dragover', files);
  dragEvent('drop', files, at);
}

/** Something arriving on the clipboard. */
function firePaste(target: EventTarget, files: File[]): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.assign(event, {
    clipboardData: {
      files,
      types: files.length > 0 ? ['Files'] : [],
      items: [],
      getData: () => '',
    },
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

/**
 * Choose files in the picker, as the person does.
 *
 * The board's picker is a real `<input type=file>` and a test cannot make a browser open a
 * dialogue on its behalf; what it can do is put files where the browser would have put them, and
 * let the change event say what a choice says.
 */
function chooseFiles(files: File[]): HTMLInputElement {
  const input = screen.getByTestId('image-picker') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files, configurable: true, writable: true });
  fireEvent.change(input);
  return input;
}

/** The box one object is drawn in, whichever of its states it is in. */
function boxFor(id: string): HTMLElement | undefined {
  return screen
    .getAllByTestId(/^image-(object|uploading|unavailable)$/)
    .find((el) => el.getAttribute('data-image-id') === id);
}

function labelFor(id: string): string {
  const box = boxFor(id);
  if (!box) return '(there is no box)';
  return box.querySelector('[data-testid="image-state-label"]')?.textContent ?? '(nothing)';
}

/**
 * Let the drop finish its reading of the files.
 *
 * Reading a file goes through `FileReader`, which answers on a later task rather than a later
 * microtask, so this yields tasks and not only promise callbacks.
 */
async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  boardId = newBoardId();
  uploads.reset();
  clearToasts();
  // jsdom has no image decoder, and the board asks the browser whether a file opens as a picture —
  // that question is the whole of why renaming a PDF to .png does not work. The test answers it:
  // yes for a file with a picture in it, no for one too short to hold one, which is the truncated
  // fixture.
  vi.stubGlobal(
    'createImageBitmap',
    (source: Blob): Promise<{ width: number; height: number }> =>
      source.size < 100
        ? Promise.reject(new Error('the file is not a picture'))
        : Promise.resolve({ width: 1440, height: 900 }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a row of pictures dropped on the board (TC-17)', () => {
  it('adds one placeholder per file, in a row that starts where the file was dropped', async () => {
    app = mountBoard();
    const files = [imageFile('png-1440x900', 'first.png'), imageFile('png-24', 'second.png')];

    dropFiles(files, { x: 300, y: 200 });
    await settle();

    const added = images();
    expect(added).toHaveLength(2);
    // Left to right, the first one's left edge at the point that was dropped on, the gap between
    // them the board's own.
    const first = geometryOf(added[0]!);
    const second = geometryOf(added[1]!);
    expect(first.x).toBe(300);
    expect(first.y).toBe(200);
    expect(second.x).toBeCloseTo(first.x + first.width + IMAGE_LAYOUT_GAP_WORLD, 0);
    expect(second.y).toBe(first.y);
    // Every box is the size its picture will be when it arrives, so nothing on the board moves
    // when it does: a 1440×900 picture is placed at the largest box it fits, in proportion.
    expect(first.width).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD + 0.001);
    expect(first.width).toBeCloseTo(800, 0);
    expect(first.height).toBeCloseTo(500, 0);
    expect(first.width / first.height).toBeCloseTo(1440 / 900, 1);

    // What the record says while the bytes are still on their way.
    expect(added[0]!.status).toBe('uploading');
    expect(added[0]!.assetKey).toBeNull();
    expect(added[0]!.uploadStartedAt).toBeTypeOf('number');
    expect(added[0]!.uploaderId).toBeTypeOf('string');
    expect(uploads.calls).toHaveLength(2);
    expect(uploads.calls[0]!.boardId).toBe(boardId);
    expect(uploads.calls[0]!.file.name).toBe('first.png');
    expect(uploads.calls[1]!.file.name).toBe('second.png');
  });

  it('shows progress in the box while the bytes go, and the picture when they arrive', async () => {
    app = mountBoard();
    dropFiles([imageFile('png-1440x900', 'screenshot.png')]);
    await settle();

    const [placeholder] = images();
    expect(placeholder).toBeDefined();
    const id = placeholder!.id;
    // Nothing has been handed to the network yet, so there is no percentage to show.
    expect(labelFor(id)).toBe('Uploading…');
    expect(screen.queryByTestId('image-progress')).toBeNull();

    await act(async () => {
      uploads.calls[0]!.progress(0.41);
    });
    expect(labelFor(id)).toBe('41%');
    const bar = screen.getByTestId('image-progress-bar');
    expect(bar.getAttribute('data-progress')).toBe('0.41');
    expect(bar.getAttribute('style')).toContain('width: 41%');

    await act(async () => {
      uploads.calls[0]!.answer({ kind: 'ok', assetKey: `${boardId}/9f3c2a4e1b7d4c8f` });
    });
    expect(imageById(id)!.status).toBe('ready');
    expect(imageById(id)!.assetKey).toBe(`${boardId}/9f3c2a4e1b7d4c8f`);
    // The box is the picture now, fetched from the address the server gave it.
    const img = screen.getByTestId('image-element') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/api/assets/${boardId}/9f3c2a4e1b7d4c8f`);
    expect(boxFor(id)!.getAttribute('data-image-status')).toBe('ready');
    expect(getToasts()).toHaveLength(0);
  });

  it('adds the files it can and says one sentence per thing wrong with the drop', async () => {
    app = mountBoard();
    // Two files whose bytes are pictures, one PDF wearing a PNG's name, and one file the board
    // has no room for by its length alone.
    dropFiles([
      imageFile('png-1440x900', 'holiday.png'),
      imageFile('pdf', 'holiday-scan.png', 'application/pdf'),
      imageFile('jpeg-24', 'holiday.jpg', 'image/jpeg'),
      imageFile('jpeg-at-limit', 'at-the-limit.jpg', 'image/jpeg'),
      oversizedImageFile(IMAGE_MAX_BYTES + 1, 'huge.jpg'),
    ]);
    await settle();

    expect(images()).toHaveLength(3);
    expect(uploads.calls.map((call) => call.file.name)).toEqual([
      'holiday.png',
      'holiday.jpg',
      'at-the-limit.jpg',
    ]);
    // One toast per reason: four files refused for two things being wrong is two sentences.
    const messages = getToasts().map((toast) => toast.message);
    expect(messages).toEqual([
      REJECTION_MESSAGES.type,
      REJECTION_MESSAGES.size,
    ]);
    expect(messages[0]).toBe('Only PNG, JPEG, GIF and WebP images can be added.');
    expect(messages[1]).toBe('Images must be 10 MB or smaller.');
  });

  it('keeps the boxes that are still on their way drawn that way while one arrives', async () => {
    app = mountBoard();
    dropFiles([
      imageFile('png-1440x900', 'a.png'),
      imageFile('webp-640x480', 'b.webp'),
      imageFile('gif-animated', 'c.gif'),
    ]);
    await settle();
    expect(images()).toHaveLength(3);
    expect(images().every((obj) => obj.status === 'uploading')).toBe(true);

    const arrived = images()[1]!;
    await act(async () => {
      uploads.calls[1]!.answer({ kind: 'ok', assetKey: `${boardId}/bbbbbbbbbbbbbbbb` });
    });
    expect(imageById(arrived.id)!.status).toBe('ready');
    expect(images().filter((obj) => obj.status === 'uploading')).toHaveLength(2);
    expect(screen.getAllByTestId('image-uploading')).toHaveLength(2);
  });
});

describe('a picture on the clipboard (TC-18)', () => {
  it('adds no image while the caret is in a sticky note being written', async () => {
    app = mountBoard();
    // A real sticky note, opened in the real editor, holding the caret.
    fireEvent.keyDown(window, { key: 'n' });
    await settle();
    const sticky = objectSnapshots(doc).find((obj) => obj.type === 'sticky');
    expect(sticky).toBeDefined();
    const note = document.querySelector(`[data-note-id="${sticky!.id}"]`) as HTMLElement;
    fireEvent.doubleClick(note);
    await settle();
    const editor = document.querySelector('textarea');
    expect(editor, 'the sticky note should be open for editing').not.toBeNull();

    const event = firePaste(editor!, [imageFile('png-1440x900', 'clipboard.png')]);
    await settle();

    // The paste belongs to the field it was made in; the board takes nothing from it.
    expect(images()).toHaveLength(0);
    expect(uploads.calls).toHaveLength(0);
    expect(event.defaultPrevented).toBe(false);
    expect(getToasts()).toHaveLength(0);
  });

  it('adds one, centred on what the board is showing, when the board is what has focus', async () => {
    app = mountBoard();
    // A board in jsdom is 1280×800 at scale 1 from the origin, so the middle of what is showing is
    // (640, 400) — and a pasted picture is put there rather than at the last place the pointer was.
    firePaste(app, [imageFile('png-1440x900', 'clipboard.png')]);
    await settle();

    const [paste] = images();
    expect(paste).toBeDefined();
    const centred = geometryOf(paste!);
    expect(centred.x + centred.width / 2).toBeCloseTo(640, 0);
    expect(centred.y + centred.height / 2).toBeCloseTo(400, 0);
    expect(uploads.calls).toHaveLength(1);
  });

  it('takes no notice of a clipboard that carries no files', async () => {
    app = mountBoard();
    const event = firePaste(app, []);
    expect(event.defaultPrevented).toBe(false);

    // Words on a clipboard are somebody else's story.
    const textPaste = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(textPaste, {
      clipboardData: { files: [], types: ['text/plain'], getData: () => 'a holiday' },
    });
    app.dispatchEvent(textPaste);
    await settle();
    expect(images()).toHaveLength(0);
    expect(uploads.calls).toHaveLength(0);
  });
});

describe('a board that cannot take an upload (TC-19)', () => {
  it('says so, adds nothing and sends nothing when a file is dropped', async () => {
    app = mountBoard('reconnecting');
    dropFiles([imageFile('png-1440x900', 'screenshot.png')]);
    await settle();

    const messages = getToasts().map((toast) => toast.message);
    expect(messages).toEqual([REJECTION_MESSAGES.offline]);
    expect(messages[0]).toBe("You're offline — images can be added when you reconnect.");
    expect(images()).toHaveLength(0);
    expect(uploads.calls).toHaveLength(0);
    expect(screen.queryAllByTestId(/^image-(object|uploading|unavailable)$/)).toHaveLength(0);
  });

  it('says so when the Image button is pressed, without opening the picker', async () => {
    app = mountBoard('connecting');
    const clicks = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByTestId('image-tool'));
    await settle();

    expect(getToasts().map((toast) => toast.message)).toEqual([REJECTION_MESSAGES.offline]);
    expect(clicks).not.toHaveBeenCalled();
    expect(images()).toHaveLength(0);
  });

  it('says nothing about a drag that carries no files', async () => {
    app = mountBoard();
    const event = new Event('dragover', { bubbles: true, cancelable: true });
    Object.assign(event, { dataTransfer: { types: ['text/plain'], files: [] } });
    app.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });
});

describe('the board refusing to take any more (TC-20)', () => {
  it('marks the box failed and says why in the toast', async () => {
    app = mountBoard();
    chooseFiles([imageFile('png-1440x900', 'screenshot.png')]);
    await settle();
    const [added] = images();
    expect(added).toBeDefined();

    await act(async () => {
      uploads.calls[0]!.answer({ kind: 'rate_limited' });
    });

    expect(imageById(added!.id)!.status).toBe('failed');
    expect(imageById(added!.id)!.assetKey).toBeNull();
    const messages = getToasts().map((toast) => toast.message);
    expect(messages).toEqual([REJECTION_MESSAGES.rate]);
    expect(messages[0]).toBe("You're adding images too quickly. Wait a minute and try again.");
    // The file is still in this tab's memory, so the box offers to send it again.
    expect(screen.getByTestId(`image-retry-${added!.id}`)).toBeTruthy();
    expect(labelFor(added!.id)).toBe('Upload failed');
  });

  it('marks the box failed and says nothing else when the upload simply did not happen', async () => {
    app = mountBoard();
    chooseFiles([imageFile('png-1440x900', 'screenshot.png')]);
    await settle();
    const [added] = images();

    await act(async () => {
      uploads.calls[0]!.answer({ kind: 'failed', status: 500 });
    });

    expect(imageById(added!.id)!.status).toBe('failed');
    // The box already says "Upload failed". Two voices saying one thing is one voice too many.
    expect(getToasts()).toHaveLength(0);
    expect(labelFor(added!.id)).toBe('Upload failed');
  });

  it('sends the same file again when Retry is pressed, and shows it uploading', async () => {
    app = mountBoard();
    chooseFiles([imageFile('png-1440x900', 'screenshot.png')]);
    await settle();
    const id = images()[0]!.id;
    await act(async () => {
      uploads.calls[0]!.answer({ kind: 'failed', status: 502 });
    });
    expect(imageById(id)!.status).toBe('failed');

    fireEvent.click(screen.getByTestId(`image-retry-${id}`));
    await settle();

    expect(uploads.calls).toHaveLength(2);
    expect(uploads.calls[1]!.file.name).toBe('screenshot.png');
    expect(imageById(id)!.status).toBe('uploading');
    expect(imageById(id)!.assetKey).toBeNull();
    expect(screen.queryByTestId(`image-retry-${id}`)).toBeNull();

    await act(async () => {
      uploads.calls[1]!.answer({ kind: 'ok', assetKey: `${boardId}/1234567890abcdef` });
    });
    expect(imageById(id)!.status).toBe('ready');
  });
});

describe('a file the browser cannot open as a picture (TC-29)', () => {
  it('says it is not a picture, adds no placeholder and uploads nothing', async () => {
    app = mountBoard();
    // The signature of a PNG and nothing after it: a file that claims, and cannot deliver.
    chooseFiles([imageFile('png-truncated', 'holiday.png', 'image/png')]);
    await settle();

    expect(images()).toHaveLength(0);
    expect(uploads.calls).toHaveLength(0);
    expect(getToasts().map((toast) => toast.message)).toEqual([REJECTION_MESSAGES.type]);
    expect(screen.queryAllByTestId(/^image-(object|uploading|unavailable)$/)).toHaveLength(0);
  });

  it('refuses a file whose name says everything and whose bytes say nothing', async () => {
    app = mountBoard();
    chooseFiles([imageFile('pdf', 'report.png', 'image/png')]);
    await settle();
    expect(images()).toHaveLength(0);
    expect(uploads.calls).toHaveLength(0);
    expect(getToasts()).toHaveLength(1);
  });
});

describe('the frame a file is dropped inside, and the picker', () => {
  it('appears when a file is dragged onto the board and goes when it leaves or lands', async () => {
    app = mountBoard();
    const files = [imageFile('png-1440x900', 'a.png')];

    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    dragEvent('dragenter', files);
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();

    // Crossing a child of the board is not leaving the board.
    dragEvent('dragleave', files, undefined, screen.getByTestId('toolbar'));
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();

    dragEvent('dragleave', files);
    expect(screen.queryByTestId('drop-highlight')).toBeNull();

    dragEvent('dragenter', files);
    dragEvent('drop', files, { x: 300, y: 200 });
    await settle();
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    expect(images()).toHaveLength(1);
  });

  it('is a real input holding the four types and more than one file', () => {
    app = mountBoard();
    const input = screen.getByTestId('image-picker') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
  });

  it('is opened by the Image button and by the I key, and the board stays on Select', async () => {
    app = mountBoard();
    const clicks = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});

    fireEvent.click(screen.getByTestId('image-tool'));
    expect(clicks).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'i' });
    expect(clicks).toHaveBeenCalledTimes(2);

    // The Image control is an action, not a mode: nothing is armed, so nothing is pressed.
    expect(screen.getByTestId('image-tool').getAttribute('aria-pressed')).toBeNull();
    expect(screen.getByTestId('select-tool').getAttribute('aria-pressed')).toBe('true');
  });

  it('takes the same file twice, because choosing it twice is two additions', async () => {
    app = mountBoard();
    const input = chooseFiles([imageFile('png-1440x900', 'a.png')]);
    await settle();
    // Cleared before anything else, so a second choice of the same file is a change.
    expect(input.value).toBe('');
    expect(images()).toHaveLength(1);

    await act(async () => {
      uploads.calls[0]!.answer({ kind: 'ok', assetKey: `${boardId}/aaaaaaaaaaaaaaaa` });
    });
    chooseFiles([imageFile('png-1440x900', 'a.png')]);
    await settle();
    expect(images()).toHaveLength(2);
    expect(uploads.calls).toHaveLength(2);
  });
});
