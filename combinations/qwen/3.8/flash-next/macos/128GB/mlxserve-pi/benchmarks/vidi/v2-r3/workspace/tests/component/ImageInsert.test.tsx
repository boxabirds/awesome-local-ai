/// <reference types="vitest" />
// Story 12, image.insert: the three ways a file arrives, and the one flow behind
// them — refuse what cannot be kept, put a placeholder on the board for what can,
// send the bytes, write down what came back.
//
// The upload itself is a mock here and that is deliberate: this file asks what the
// board *does* with a file, which is a question about order and about words — was a
// placeholder written before the request, was one written for a file that was
// refused, what did the person get told. The bytes on the wire are the integration
// tier's question (tests/integration/image-assets.test.ts, against a real bucket).
//
// The other thing worth saying: a placeholder is waited for rather than asserted
// synchronously, because the flow decodes each file before it writes anything — a
// browser's decoder is asynchronous, and a test that pretended otherwise would be a
// test of a flow that does not exist.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebsocketProvider } from 'y-websocket';
import type * as Y from 'yjs';
import { Board } from '../../src/client/board/Board';
import { snapshotAll, type ImageSnap } from '../../src/shared/board-model';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
} from '../../src/shared/config';
import { assetPath, boardAssetsPath } from '../../src/shared/routes';
import { newBoardId } from '../../src/shared/board-id';
import type { Camera } from '../../src/client/canvas/camera';
import { createNote, createTextObject, editorOf, noteEl, openTextEditor, pressOn, releaseOn } from './helpers';

/** The upload, stood in for: every call is recorded, and the test decides when it
 *  finishes and with what. */
const uploads = vi.hoisted(() => ({
  calls: [] as {
    boardId: string;
    file: File;
    aborted: boolean;
    send: (fraction: number) => void;
    finish: (result: Record<string, unknown>) => void;
  }[],
}));

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (boardId: string, file: File, onProgress?: (fraction: number) => void) => {
    let finish: (result: Record<string, unknown>) => void = () => {};
    const promise = new Promise<Record<string, unknown>>((resolve) => {
      finish = resolve;
    });
    const call = {
      boardId,
      file,
      aborted: false,
      send: (fraction: number) => onProgress?.(fraction),
      finish: (result: Record<string, unknown>) => finish(result),
      promise,
    };
    uploads.calls.push(call);
    return {
      promise,
      abort(): void {
        call.aborted = true;
        finish({ kind: 'failed' });
      },
    };
  },
}));

const ok = (assetKey: string, contentType = 'image/png'): Record<string, unknown> => ({
  kind: 'ok',
  assetKey,
  contentType,
});

/** What a browser's decoder answers: the picture's own size, or nothing at all. */
function stubDecoder(size: { width: number; height: number } | 'rejects'): void {
  vi.stubGlobal('createImageBitmap', (_file: File) =>
    size === 'rejects'
      ? Promise.reject(new Error('this is not an image'))
      : Promise.resolve({ width: size.width, height: size.height, close: () => {} }),
  );
}

/** A file the browser would call a PNG. */
const png = (name = 'photo.png', type = 'image/png', size = 64): File =>
  new File([new Uint8Array(size)], name, { type });

/** A drag's or a paste's payload, in the shape the board reads it. */
const dataTransfer = (files: File[]): Record<string, unknown> => ({
  files,
  items: files.map((file) => ({ kind: 'file', file })),
  types: files.length > 0 ? ['Files'] : [],
  getData: () => '',
  setData: () => {},
  dropEffect: '',
});

const surface = (): HTMLElement => screen.getByTestId('board-viewport');

/** A drop on the board at one point, as the browser fires it.
 *
 * Built by hand rather than with `fireEvent.drop`, because jsdom has no DragEvent:
 * testing-library falls back to a plain Event, which keeps `dataTransfer` but drops
 * `clientX` on the floor — and a drop without a point where the pointer was is a
 * drop of a picture that has nowhere to go. */
function dropOnBoard(files: File[], clientX = 300, clientY = 200): boolean {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer(files) });
  Object.defineProperty(event, 'clientX', { value: clientX });
  Object.defineProperty(event, 'clientY', { value: clientY });
  return fireEvent(surface(), event) as boolean;
}

/** A paste on the window, with whatever the clipboard was holding. */
function paste(files: File[], target: Window | Document | Element = window): void {
  fireEvent.paste(target, { clipboardData: dataTransfer(files) });
}

const toasts = (): string[] =>
  screen.queryAllByTestId('toast').map((element) => element.textContent ?? '');

interface Harness {
  doc: Y.Doc;
  provider: WebsocketProvider;
  boardId: string;
  images(): ImageSnap[];
  camera(): Camera;
}

/**
 * A board whose room has agreed the document, which is the state a person has to be
 * in before any of this means anything: a board that is still loading is a board
 * that cannot be told about a file.
 */
function boardOn(label: string): Harness {
  const boardId = `component${label}`;
  let doc: Y.Doc | null = null;
  let provider: WebsocketProvider | null = null;
  act(() => {
    render(
      <Board
        boardId={boardId}
        onDocReady={(next: Y.Doc) => {
          doc = next;
        }}
        onProviderReady={(next: WebsocketProvider) => {
          provider = next;
        }}
      />,
    );
  });
  if (doc === null || provider === null) throw new Error('the board did not hand over its document');
  const agreed = provider;
  feed(agreed, 'status', { status: 'connected' });
  feed(agreed, 'sync', true);
  const here = doc;
  return {
    doc: here,
    provider: agreed,
    boardId,
    images: () => snapshotAll(here).filter((object) => object.type === 'image') as ImageSnap[],
    camera: () => window.__vidi6?.getCamera() ?? { x: 0, y: 0, zoom: 1 },
  };
}

/** Let the flow get as far as it is going to: the decode is a promise. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** lib0's `emit(name, args)` spreads `args` into the handlers, so an event is given
 *  as a one-element array — the same convention ConnectionStatus.test.tsx uses. */
function feed(
  provider: WebsocketProvider,
  name: 'status' | 'sync',
  arg: { status: 'connected' | 'disconnected' | 'connecting' } | boolean,
): void {
  act(() => {
    provider.emit(name, [arg] as never);
  });
}

/** The room's link goes down, the way it does when a train goes through a tunnel. */
function loseLink(board: Harness): void {
  feed(board.provider, 'status', { status: 'disconnected' });
}

const backUp = (board: Harness): void => {
  feed(board.provider, 'status', { status: 'connected' });
  feed(board.provider, 'sync', true);
};

beforeEach(() => {
  uploads.calls.length = 0;
  stubDecoder({ width: 1600, height: 1200 });
});


describe('TC-17: a dropped picture is on the board before its bytes are anywhere', () => {
  it('one PNG, dropped, becomes one uploading image at the picture’s own size', async () => {
    const board = boardOn('DropOne');
    expect(board.images()).toEqual([]);

    dropOnBoard([png('sunset.png')]);
    await settle();
    const after = board.images();

    expect(after).toHaveLength(1);
    const image = after[0]!;
    expect(image.status).toBe('uploading');
    expect(image.assetKey).toBeNull();
    // The box is the picture's own shape, capped at the longest side the board
    // places at: the file was 1600x1200, so the board is showing 800x600, and nothing
    // about the picture has to change when the bytes turn up.
    expect(image.width).toBe(800);
    expect(image.height).toBe(600);
    expect(image.naturalWidth).toBe(1600);
    expect(image.naturalHeight).toBe(1200);
    expect(image.contentType).toBe('image/png');
    // The file's name is not board state: it was never sent and never stored.
    expect(JSON.stringify(image)).not.toContain('sunset');

    // The upload went out, to this board's own address, with the file in it.
    expect(uploads.calls).toHaveLength(1);
    expect(uploads.calls[0]!.boardId).toBe(board.boardId);
    expect(boardAssetsPath(board.boardId)).toBe(`/api/boards/${board.boardId}/assets`);
  });

  it('the placeholder is drawn at the size the finished picture will be', async () => {
    const board = boardOn('BoxWhileUploading');
    dropOnBoard([png('sunset.png')]);
    await settle();

    const shown = screen.getByTestId('image-object');
    expect(shown.getAttribute('data-status')).toBe('uploading');
    // The placeholder is not an empty box waiting to be filled: it has a size, and
    // it is the size the finished picture will be, so nothing on the board moves.
    expect(Number(shown.getAttribute('data-box-width'))).toBe(800);
    expect(Number(shown.getAttribute('data-box-height'))).toBe(600);
    // This tab is the one holding the file, so this tab gets the bar.
    expect(screen.getByTestId('image-uploading-mine')).toBeInTheDocument();
    expect(screen.queryByTestId('image-uploading')).toBeNull();
  });

  it('the bar is the upload, and the picture replaces it when the answer comes', async () => {
    const board = boardOn('BarThenPicture');
    dropOnBoard([png('sunset.png')]);
    await settle();

    act(() => {
      uploads.calls[0]!.send(0.63);
    });
    expect(screen.getByTestId('image-uploading-mine').getAttribute('aria-valuenow')).toBe('63');
    expect(screen.getByText('63%')).toBeInTheDocument();
    expect(screen.queryByTestId('image-img')).toBeNull();

    const key = `${newBoardId()}/${newBoardId()}`;
    act(() => {
      uploads.calls[0]!.finish(ok(key));
    });
    await waitFor(() => expect(screen.queryByTestId('image-img')).not.toBeNull());

    const image = board.images()[0]!;
    expect(image.status).toBe('ready');
    expect(image.assetKey).toBe(key);
    expect(screen.getByTestId('image-img')).toHaveAttribute('src', assetPath(key));
    expect(screen.getByTestId('image-img')).toHaveAttribute('alt', 'Image');
    expect(screen.queryByTestId('image-uploading-mine')).toBeNull();
  });

  it('a picture whose upload came back refused says so, and offers Retry', async () => {
    const board = boardOn('UploadRefused');
    dropOnBoard([png('sunset.png')]);
    await settle();

    act(() => {
      uploads.calls[0]!.finish({ kind: 'failed', status: 413 });
    });
    await waitFor(() => expect(screen.queryByTestId('image-failed')).not.toBeNull());

    const image = board.images()[0]!;
    expect(image.status).toBe('failed');
    expect(image.assetKey).toBeNull();
    expect(screen.getByTestId('image-failed')).toHaveTextContent('Upload failed');
    expect(screen.getByTestId('image-retry')).toBeInTheDocument();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
  });

  it('a drop goes where the pointer was', async () => {
    const board = boardOn('WhereItWent');
    const camera = board.camera();

    dropOnBoard([png('one.png')], 300, 200);
    await settle();
    const dropped = board.images()[0]!;

    // The board point the pointer was over, measured the same way every other point
    // on this board is measured: the point, plus half of what the zoom makes of it.
    expect(dropped.x).toBeCloseTo(camera.x + 300 / camera.zoom, 3);
    expect(dropped.y).toBeCloseTo(camera.y + 200 / camera.zoom, 3);
  });

  it('a pasted picture goes where the person is looking', async () => {
    const board = boardOn('PasteCentre');
    const camera = board.camera();

    paste([png('clipboard.png')]);
    await settle();
    const pasted = board.images()[0]!;

    // 1280x800 is the component tier's viewport; a 1600x1200 file is placed at
    // 800x600, so its left edge is the middle of the view less half of that.
    expect(pasted.x).toBeCloseTo(camera.x + 1280 / camera.zoom / 2 - 400, 3);
    expect(pasted.y).toBeCloseTo(camera.y + 800 / camera.zoom / 2 - 300, 3);
    expect(uploads.calls).toHaveLength(1);
  });

  it('a picture pasted into a note’s words is a sentence, not a picture', async () => {
    // The rule the whole story turns on for anybody who types: a paste inside a note
    // belongs to the note. It is left alone rather than refused, because a toast about
    // formats would be a toast about the sentence somebody was writing.
    const board = boardOn('PasteIntoNote');
    const note = createNote(board.doc, 0, 0);
    const noteElement = noteEl(note);
    pressOn(noteElement, 100, 100);
    releaseOn(noteElement, 100, 100);
    fireEvent.doubleClick(noteElement, { clientX: 100, clientY: 100 });
    const editor = document.querySelector('textarea');
    if (editor === null) throw new Error('the note did not open');

    paste([png('clipboard.png')], editor);
    await settle();

    expect(toasts()).toEqual([]);
    expect(board.images()).toEqual([]);
    expect(uploads.calls).toEqual([]);
  });
});

describe('TC-18: what the board will not take, and the words it uses to say so', () => {
  it('a PDF is refused with the sentence about formats, and nothing is put on the board', async () => {
    const board = boardOn('Pdf');

    expect(dropOnBoard([png('report.pdf', 'application/pdf')])).toBe(false);
    await settle();

    expect(toasts()).toEqual([REJECTION_MESSAGES.type]);
    expect(board.images()).toEqual([]);
    expect(uploads.calls).toEqual([]);
    // The browser is told not to open the file in the page instead — even for a drop
    // the board is refusing, which is the difference between a drop and an accident.
  });

  it('an SVG is refused, whatever it is called', async () => {
    const board = boardOn('Svg');
    dropOnBoard([png('vector.svg', 'image/svg+xml')]);
    await settle();

    expect(toasts()).toEqual([REJECTION_MESSAGES.type]);
    expect(board.images()).toEqual([]);
  });

  it('bytes which are not a picture are refused as the wrong type, whatever the type says', async () => {
    // The file the browser believes is a PNG and the bytes disagree with: the decode
    // is the second half of "is this a picture?", and it answers with the same
    // sentence as the first half.
    stubDecoder('rejects');
    const board = boardOn('Undecodable');

    dropOnBoard([png('broken.png')]);
    await settle();

    expect(toasts()).toEqual([REJECTION_MESSAGES.type]);
    expect(board.images()).toEqual([]);
    expect(uploads.calls).toEqual([]);
  });

  it('a file bigger than the limit is refused before a request is made', async () => {
    const board = boardOn('TooBig');

    dropOnBoard([png('huge.png', 'image/png', IMAGE_MAX_BYTES + 1)]);
    await settle();

    expect(toasts()).toEqual([REJECTION_MESSAGES.size]);
    expect(board.images()).toEqual([]);
    // Nothing was sent, so nothing was put on the board to fail: a file the board
    // never asked about leaves no record of ever having been there.
    expect(uploads.calls).toEqual([]);
  });

  it('a good file in a bad drop still gets on the board', async () => {
    const board = boardOn('Mixed');

    dropOnBoard([png('report.pdf', 'application/pdf'), png('sunset.png')]);
    await settle();

    expect(toasts()).toEqual([REJECTION_MESSAGES.type]);
    expect(board.images()).toHaveLength(1);
    expect(uploads.calls).toHaveLength(1);
    expect(board.images()[0]!.status).toBe('uploading');
  });

  it('forty wrong files are one refusal, not forty', async () => {
    const board = boardOn('ManyWrong');

    dropOnBoard(Array.from({ length: 40 }, (_unused, index) => png(`doc${index}.pdf`, 'application/pdf')));
    await settle();

    expect(toasts()).toEqual([REJECTION_MESSAGES.type]);
  });

  it('a drop of nothing the board could use leaves the board as it was', async () => {
    const board = boardOn('NothingUseful');
    const before = board.images();

    dropOnBoard([png('a.pdf', 'application/pdf'), png('b.svg', 'image/svg+xml'), png('c.mp4', 'video/mp4')]);
    await settle();

    expect(board.images()).toEqual(before);
    expect(toasts()).toEqual([REJECTION_MESSAGES.type]);
  });
});

describe('TC-19: twenty pictures at once are one thing', () => {
  it('a drop of twenty-one keeps twenty, says why, and the twenty are one undo', async () => {
    const board = boardOn('TwentyOne');

    dropOnBoard(Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, index) => png(`p${index}.png`)));
    await settle();
    const after = board.images();

    expect(after).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(toasts()).toEqual([REJECTION_MESSAGES.count]);
    expect(uploads.calls).toHaveLength(IMAGE_MAX_FILES_PER_ADD);

    // In a row, in the order they were dropped: twenty pictures dropped together
    // arrive as a row of pictures rather than as a pile at one point.
    const xs = after.map((image) => image.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const steps = xs.slice(1).map((x, index) => x - xs[index]!);
    for (const step of steps) expect(step).toBeCloseTo(800 + IMAGE_LAYOUT_GAP_WORLD, 3);
    // The tops are in line, which is what a row is.
    expect(new Set(after.map((image) => image.y))).toEqual(new Set([after[0]!.y]));

    // And one undo takes the whole drop back, because it was one thing that happened.
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    await waitFor(() => expect(board.images()).toEqual([]));
  });

  it('exactly twenty are taken without a word of complaint', async () => {
    const board = boardOn('ExactlyTwenty');

    dropOnBoard(Array.from({ length: IMAGE_MAX_FILES_PER_ADD }, (_unused, index) => png(`p${index}.png`)));
    await settle();

    expect(board.images()).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(toasts()).toEqual([]);
  });

  it('the whole row is one update for everybody else', async () => {
    const board = boardOn('OneUpdate');
    let updates = 0;
    board.doc.on('update', () => {
      updates += 1;
    });

    dropOnBoard(Array.from({ length: 5 }, (_unused, index) => png(`p${index}.png`)));
    await settle();

    // Five placeholders, one update: what the other person's board receives is a
    // row, not five separate arrivals to be watched in.
    expect(board.images()).toHaveLength(5);
    expect(updates).toBe(1);
  });

  it('the twenty-one files are twenty-one uploads, one per picture', async () => {
    const board = boardOn('OneUploadEach');

    dropOnBoard(Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 3 }, (_unused, index) => png(`p${index}.png`)));
    await settle();

    expect(board.images()).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(uploads.calls).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(new Set(uploads.calls.map((call) => call.file.name)).size).toBe(IMAGE_MAX_FILES_PER_ADD);
  });

  it('a batch that all comes back keeps every picture it belongs to', async () => {
    const board = boardOn('BatchComesBack');

    dropOnBoard(Array.from({ length: 4 }, (_unused, index) => png(`p${index}.png`)));
    await settle();
    const ids = board.images().map((image) => image.id);

    act(() => {
      uploads.calls.forEach((call, index) => call.finish(ok(`${newBoardId()}/asset${index}`)));
    });
    await waitFor(() => expect(board.images().every((image) => image.status === 'ready')).toBe(true));

    expect(board.images().map((image) => image.id)).toEqual(ids);
    expect(new Set(board.images().map((image) => image.assetKey)).size).toBe(4);
    expect(screen.getAllByTestId('image-img')).toHaveLength(4);
  });
});

describe('TC-29: a board with no link says so, in the same words, whichever way in', () => {
  it('a file dropped while the link is down is refused, with the offline sentence', async () => {
    const board = boardOn('OfflineDrop');
    loseLink(board);

    dropOnBoard([png('sunset.png')]);
    await settle();

    expect(toasts()).toEqual([REJECTION_MESSAGES.offline]);
    expect(board.images()).toEqual([]);
    expect(uploads.calls).toEqual([]);
  });

  it('a file pasted while the link is down is refused with the same sentence', async () => {
    const board = boardOn('OfflinePaste');
    loseLink(board);

    paste([png('clipboard.png')]);
    await settle();

    expect(toasts()).toEqual([REJECTION_MESSAGES.offline]);
    expect(board.images()).toEqual([]);
  });

  it('the file dialogue is not even opened while the link is down', async () => {
    // A dialogue that let somebody choose a file and then refused it is a dialogue
    // that wasted their time on purpose, so the answer comes before it.
    const board = boardOn('OfflinePicker');
    loseLink(board);

    const input = screen.getByTestId('image-file-input');
    const clicked = vi.spyOn(input as HTMLInputElement, 'click');

    act(() => {
      fireEvent.click(screen.getByLabelText('Image'));
    });
    expect(clicked).not.toHaveBeenCalled();
    expect(toasts()).toEqual([REJECTION_MESSAGES.offline]);

    act(() => {
      fireEvent.keyDown(window, { key: 'i' });
    });
    expect(clicked).not.toHaveBeenCalled();
    expect(toasts()).toEqual([REJECTION_MESSAGES.offline, REJECTION_MESSAGES.offline].slice(0, 1));
  });

  it('the letter i in a word somebody is writing is a letter', async () => {
    // The one key this feature adds is a key that opens an operating system dialogue, so
    // it is the key with the most to lose from going off at the wrong moment. The ordinary
    // protection is that the editor is the target of the keystroke and keeps it. This is
    // the protection for the moment when it is not: the click that opened a text object
    // has landed, the caret has not arrived in the editor yet, and the first letters of
    // the word are arriving at the window. In that moment the 'i' of "Heading" is a letter
    // of the word, and a board that answers it with a dialogue has eaten a letter and
    // interrupted the person writing it.
    const board = boardOn('WritingAnI');
    const id = createTextObject(board.doc, 40, -20);
    openTextEditor(id);

    const input = screen.getByTestId('image-file-input');
    const clicked = vi.spyOn(input as HTMLInputElement, 'click');

    act(() => {
      fireEvent.keyDown(window, { key: 'i' });
    });
    expect(clicked).not.toHaveBeenCalled();
    expect(board.images()).toEqual([]);
    expect(uploads.calls).toEqual([]);

    // With nothing being written, the same key is the shortcut it is meant to be.
    act(() => {
      fireEvent.keyDown(editorOf(id), { key: 'Escape' });
    });
    await settle();
    act(() => {
      fireEvent.keyDown(window, { key: 'i' });
    });
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('the link coming back does not resurrect the file that was refused', async () => {
    const board = boardOn('BackAgain');
    loseLink(board);
    dropOnBoard([png('sunset.png')]);
    await settle();
    expect(board.images()).toEqual([]);

    backUp(board);
    await settle();

    expect(board.images()).toEqual([]);
    expect(uploads.calls).toEqual([]);
  });

  it('a picture dropped after the link comes back goes up', async () => {
    const board = boardOn('BackAndDrop');
    loseLink(board);
    dropOnBoard([png('sunset.png')]);
    await settle();

    backUp(board);
    dropOnBoard([png('later.png')]);
    await settle();

    expect(board.images()).toHaveLength(1);
    expect(board.images()[0]!.status).toBe('uploading');
    expect(uploads.calls).toHaveLength(1);
  });

  it('a file the board could not have kept anyway is refused by format, link or no link', async () => {
    // Which of the two sentences a person gets is a small thing and a real one: the
    // link is the more urgent, because it says nothing will ever arrive.
    const board = boardOn('OfflineAndWrong');
    loseLink(board);

    dropOnBoard([png('report.pdf', 'application/pdf')]);
    await settle();

    expect(toasts()).toEqual([REJECTION_MESSAGES.offline]);
  });
});

describe('TC-24: the same file up again, from the tab that still has it', () => {
  it('a Retry sends that file up again, and the picture is uploading once more', async () => {
    const board = boardOn('RetryGoesUp');
    dropOnBoard([png('sunset.png')]);
    await settle();

    act(() => {
      uploads.calls[0]!.finish({ kind: 'failed', status: 500 });
    });
    await waitFor(() => expect(board.images()[0]!.status).toBe('failed'));
    expect(screen.getByTestId('image-retry')).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByTestId('image-retry'));
    });

    // Back to uploading in the document, which is the only way the other person's
    // board learns this one is trying again.
    expect(board.images()[0]!.status).toBe('uploading');
    expect(board.images()[0]!.assetKey).toBeNull();
    expect(uploads.calls).toHaveLength(2);
    expect(uploads.calls[1]!.file.name).toBe('sunset.png');
    expect(screen.getByTestId('image-uploading-mine')).toBeInTheDocument();

    const key = `${newBoardId()}/${newBoardId()}`;
    act(() => {
      uploads.calls[1]!.finish(ok(key));
    });
    await waitFor(() => expect(board.images()[0]!.status).toBe('ready'));
    expect(screen.getByTestId('image-img')).toHaveAttribute('src', assetPath(key));
  });

  it('a failed upload leaves no bar behind', async () => {
    const board = boardOn('NoStaleBar');
    dropOnBoard([png('sunset.png')]);
    await settle();

    act(() => {
      uploads.calls[0]!.send(0.63);
    });
    expect(screen.getByText('63%')).toBeInTheDocument();

    act(() => {
      uploads.calls[0]!.finish({ kind: 'failed', status: 500 });
    });
    await waitFor(() => expect(screen.queryByTestId('image-failed')).not.toBeNull());

    // A bar which stopped at 63 % would be a bar describing a transfer that is not
    // happening.
    expect(screen.queryByText('63%')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('undo after a failed upload takes the failure off the board with the picture', async () => {
    const board = boardOn('UndoFailure');
    dropOnBoard([png('sunset.png')]);
    await settle();
    act(() => {
      uploads.calls[0]!.finish({ kind: 'failed', status: 500 });
    });
    await waitFor(() => expect(board.images()[0]!.status).toBe('failed'));

    // One undo removes the placeholder in one step, and the completion which failed is
    // not a second step anybody has to undo first.
    act(() => {
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    });
    await waitFor(() => expect(board.images()).toEqual([]));
  });
});

describe('the board while files are being dragged over it', () => {
  it('a drag carrying files says "here", and leaving takes it away again', () => {
    boardOn('Highlight');
    const transfer = dataTransfer([png('sunset.png')]);

    fireEvent.dragEnter(surface(), { dataTransfer: transfer });
    expect(screen.getByTestId('drop-highlight')).toBeInTheDocument();

    fireEvent.dragLeave(surface(), { dataTransfer: transfer });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });

  it('a drag over the board of something which is not a file says nothing', () => {
    boardOn('NoHighlight');

    fireEvent.dragEnter(surface(), {
      dataTransfer: { files: [], types: ['text/plain'], getData: () => 'a sentence', dropEffect: '' },
    });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });

  it('a drag which crosses the board’s own children does not blink out', () => {
    // Every child the drag passes into fires a dragleave on the board, and a
    // highlight that went away on the first of them would be a highlight flickering
    // all the way to the drop.
    boardOn('DragDepth');
    const transfer = dataTransfer([png('sunset.png')]);

    fireEvent.dragEnter(surface(), { dataTransfer: transfer });
    fireEvent.dragEnter(surface(), { dataTransfer: transfer });
    fireEvent.dragLeave(surface(), { dataTransfer: transfer });
    expect(screen.getByTestId('drop-highlight')).toBeInTheDocument();

    fireEvent.dragLeave(surface(), { dataTransfer: transfer });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });

  it('the highlight does not take the live region away from the toasts', () => {
    boardOn('LiveRegion');
    const transfer = dataTransfer([png('sunset.png')]);

    fireEvent.dragEnter(surface(), { dataTransfer: transfer });
    expect(screen.getByTestId('drop-highlight')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('toast-host')).toHaveAttribute('aria-live', 'polite');
  });

  it('a drop clears the highlight, whatever became of the files', async () => {
    const board = boardOn('HighlightAfterDrop');
    const transfer = dataTransfer([png('report.pdf', 'application/pdf')]);

    fireEvent.dragEnter(surface(), { dataTransfer: transfer });
    dropOnBoard([png('report.pdf', 'application/pdf')]);
    await settle();

    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    expect(board.images()).toEqual([]);
  });
});
