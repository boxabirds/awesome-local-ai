// Story 12 · Drop images onto the board — the three ways a picture gets added.
//
// Drop, paste and the picker share one flow, so they are tested as one flow with three front
// doors: each test sends files in through one door and asserts what the board ends up holding —
// placeholders in the right place, one undo step, uploads running with progress, and statuses
// that say what actually happened. The hook is the thing under test rather than the rendered
// `App`, on purpose: where a drag's files come from is a browser matter (covered end to end in
// `tests/e2e`), and what the board does with them is this.
//
// TC-17 drop 3 files → 3 placeholders in a row from the drop point; progress as the upload
//       reports it; `ready` when it resolves
// TC-18 paste while a text field has the caret adds nothing (negative); paste with the board
//       focused lands centred in the view
// TC-19 a board that is not up refuses the drop: the offline message, no objects, no upload
// TC-29 a file that will not decode: the type message, no placeholder, no upload
//
// Plus the parts of the same contract the numbered cases lean on: the refusal messages arriving
// from validation, the picker being refused before it opens rather than after, Retry sending the
// same bytes again, and the highlight coming and going with the files.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';
import * as Y from 'yjs';

import { initDoc, objectSnapshots } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import { IMAGE_TYPE, type ImageSnapshot } from '../../src/shared/objects/image';
import type { Camera } from '../../src/client/canvas/camera';
import {
  useImageInsert,
  type DragGesture,
  type PasteGesture,
} from '../../src/client/images/useImageInsert';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { activeToasts, clearToasts } from '../../src/client/ui/Toast';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

/**
 * The upload layer, replaced with something a test can finish by hand.
 *
 * Every call is recorded and left pending until the test resolves it, which is the only way to
 * look at a board while an upload is in the middle — a state that lasts a second or two in real
 * life and forever in a test.
 */
const uploads = vi.hoisted(() => ({
  calls: [] as {
    boardId: string;
    file: File;
    onProgress(fraction: number): void;
    resolve(assetKey: string): void;
    fail(): void;
    aborted: boolean;
  }[],
}));

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (boardId: string, file: File, onProgress: (fraction: number) => void) => {
    let settle!: (result: { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number }) => void;
    const promise = new Promise<{ kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number }>(
      (resolve) => {
        settle = resolve;
      },
    );
    const call = {
      boardId,
      file,
      onProgress,
      aborted: false,
      resolve(assetKey: string) {
        settle({ kind: 'ok', assetKey });
      },
      fail() {
        settle({ kind: 'failed', status: 500 });
      },
    };
    uploads.calls.push(call);
    return {
      promise,
      abort() {
        call.aborted = true;
        settle({ kind: 'failed' });
      },
    };
  },
}));

const ME = 'leo';
const BOARD = 'a'.repeat(22);
const HOME: Camera = { x: 0, y: 0, zoom: 1 };

/** How big each file "decodes" to. The real decoder is stubbed out below. */
const SIZES = new Map<string, { width: number; height: number }>([
  ['one.png', { width: 400, height: 300 }],
  ['two.jpg', { width: 200, height: 200 }],
  ['three.gif', { width: 600, height: 400 }],
  ['four.webp', { width: 100, height: 500 }],
]);

/** A file the board will accept: its type is one of the four, and it decodes. */
function picture(name: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, {
    type: name.endsWith('.png')
      ? 'image/png'
      : name.endsWith('.jpg')
        ? 'image/jpeg'
        : name.endsWith('.gif')
          ? 'image/gif'
          : 'image/webp',
  });
}

/** A file whose declared type is not one of the four. */
function wrongType(name = 'diagram.pdf'): File {
  return new File([new Uint8Array(64)], name, { type: 'application/pdf' });
}

/** The decoder, standing in for the browser's: real sizes, and able to fail. */
function stubDecoder(failFor: (file: File) => boolean = () => false): void {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: File) => {
      if (failFor(file)) throw new Error('cannot decode');
      const size = SIZES.get(file.name) ?? { width: 320, height: 240 };
      return { width: size.width, height: size.height, close() {} };
    }),
  );
}

/** A drag of files, as the board sees it: `types` says Files, and they are there. */
function drop(files: File[], at = { x: 100, y: 200 }): DragGesture {
  return {
    dataTransfer: {
      types: ['Files'],
      files,
      dropEffect: 'none',
    } as unknown as DataTransfer,
    clientX: at.x,
    clientY: at.y,
    currentTarget: document.body,
    relatedTarget: null,
    preventDefault() {},
  };
}

/** A drag of something that is not files — selected text, or a link. */
function dragText(): DragGesture {
  return {
    dataTransfer: { types: ['text/plain'], files: [], dropEffect: 'none' } as unknown as DataTransfer,
    clientX: 0,
    clientY: 0,
    currentTarget: document.body,
    relatedTarget: null,
    preventDefault: vi.fn(),
  };
}

/** A paste, with the caret wherever the test says it was. */
function paste(files: File[], target: EventTarget): PasteGesture {
  return {
    target,
    clipboardData: { types: ['Files'], files } as unknown as DataTransfer,
    preventDefault: vi.fn(),
  };
}

/** Mount the hook against a fresh document. */
function mount(over?: Partial<{ connection: ConnectionState; boardId: string }>) {
  const doc = new Y.Doc();
  initDoc(doc);
  let boundaries = 0;
  const rendered = renderHook((props: { connection: ConnectionState; boardId: string }) =>
    useImageInsert({
      doc,
      boardId: props.boardId,
      camera: HOME,
      connection: props.connection,
      identityId: ME,
      boundary() {
        boundaries += 1;
      },
    }),
    { initialProps: { connection: over?.connection ?? 'connected', boardId: over?.boardId ?? BOARD } },
  );
  return {
    doc,
    // `renderHook` hands back `{ result, rerender, ... }`; `result` is the live handle.
    handle: rendered.result,
    boundaries: () => boundaries,
    images: () =>
      objectSnapshots(doc).filter((object) => object.type === IMAGE_TYPE) as ImageSnapshot[],
    rerender(props?: Partial<{ connection: ConnectionState; boardId: string }>) {
      rendered.rerender({
        connection: props?.connection ?? 'connected',
        boardId: props?.boardId ?? BOARD,
      });
    },
  };
}

/** Let the hook's promise chain run, and React take the state updates that came with it. */
async function settle(times = 4): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  uploads.calls.length = 0;
  clearToasts();
  stubDecoder();
});

afterEach(() => {
  clearToasts();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('adding images by dropping them (story 12 · TC-17)', () => {
  it('puts three placeholders in a row under the cursor, in one undo step', async () => {
    const board = mount();
    const { handle } = board;

    act(() => {
      handle.current.onDrop(drop([picture('one.png'), picture('two.jpg'), picture('three.gif')]));
    });
    await settle();

    const images = board.images();
    expect(images).toHaveLength(3);
    // One add action is one thing the person did, so it is one step for Undo (`image.add_one_step`).
    expect(board.boundaries()).toBeGreaterThanOrEqual(2);
    // Every upload was started, against this board, with the file that stands behind it.
    expect(uploads.calls.map((call) => call.file.name)).toEqual(['one.png', 'two.jpg', 'three.gif']);
    expect(uploads.calls[0]?.boardId).toBe(BOARD);

    // The first image's top-left corner is where the pointer was; the rest follow to the right
    // in one row with the layout gap between them (`image.drop`, `image.layout`).
    expect(images[0]?.x).toBe(100);
    expect(images[0]?.y).toBe(200);
    expect(images[1]?.x).toBe(100 + images[0]!.width + IMAGE_LAYOUT_GAP_WORLD);
    expect(images[2]?.x).toBe(
      images[1]!.x + images[1]!.width + IMAGE_LAYOUT_GAP_WORLD,
    );
    expect(images.map((image) => image.y)).toEqual([200, 200, 200]);

    // Placeholders, not pictures: waiting, with this person's id and the clock on them.
    for (const image of images) {
      expect(image.status).toBe('uploading');
      expect(image.uploaderId).toBe(ME);
      expect(image.assetKey).toBeNull();
      expect(image.uploadStartedAt).toBeGreaterThan(0);
    }
  });

  it('reports progress as the upload sends bytes, and only while it is running', async () => {
    const board = mount();
    const { handle } = board;
    act(() => {
      handle.current.onDrop(drop([picture('one.png')]));
    });
    await settle();

    const id = board.images()[0]!.id;
    expect(handle.current.progress.get(id)).toBe(0);

    act(() => {
      uploads.calls[0]!.onProgress(0.4);
    });
    expect(handle.current.progress.get(id)).toBe(0.4);

    act(() => {
      uploads.calls[0]!.resolve('key/one');
    });
    await settle();

    // Done: the number is gone with the upload, and the document says what is true now.
    expect(handle.current.progress.has(id)).toBe(false);
    expect(board.images()[0]?.status).toBe('ready');
    expect(board.images()[0]?.assetKey).toBe('key/one');
  });

  it('marks the placeholder failed when the upload does not land, and keeps the file', async () => {
    const board = mount();
    const { handle } = board;
    act(() => {
      handle.current.onDrop(drop([picture('one.png')]));
    });
    await settle();
    const id = board.images()[0]!.id;

    act(() => {
      uploads.calls[0]!.fail();
    });
    await settle();

    expect(board.images()[0]?.status).toBe('failed');
    expect(handle.current.progress.has(id)).toBe(false);
    // The bytes are still in memory, so Retry has something to send (`image.upload_failure`).
    expect(handle.current.canRetry(id)).toBe(true);
  });

  it('retries with the same bytes, and takes the placeholder back to uploading', async () => {
    const board = mount();
    const { handle } = board;
    act(() => {
      handle.current.onDrop(drop([picture('one.png')]));
    });
    await settle();
    const id = board.images()[0]!.id;
    act(() => {
      uploads.calls[0]!.fail();
    });
    await settle();
    expect(board.images()[0]?.status).toBe('failed');

    let retried = false;
    act(() => {
      retried = handle.current.retry(id);
    });
    await settle();
    expect(retried).toBe(true);
    expect(uploads.calls).toHaveLength(2);
    expect(uploads.calls[1]?.file.name).toBe('one.png');
    expect(board.images()[0]?.status).toBe('uploading');

    act(() => {
      uploads.calls[1]!.resolve('key/two');
    });
    await settle();
    expect(board.images()[0]?.status).toBe('ready');
    expect(board.images()[0]?.assetKey).toBe('key/two');
    // Nothing to retry now, and nothing kept in memory for it.
    expect(handle.current.canRetry(id)).toBe(false);
  });

  it('refuses to retry what this tab no longer has — a reload lost the file (TC-24)', async () => {
    const board = mount();
    const { handle } = board;
    expect(handle.current.canRetry('no-such-object')).toBe(false);
    expect(handle.current.retry('no-such-object')).toBe(false);
    expect(uploads.calls).toHaveLength(0);
  });

  it('forgets an object that has been removed, and stops caring about its upload', async () => {
    const board = mount();
    const { handle } = board;
    act(() => {
      handle.current.onDrop(drop([picture('one.png')]));
    });
    await settle();
    const id = board.images()[0]!.id;

    act(() => {
      handle.current.forget(id);
    });
    expect(handle.current.canRetry(id)).toBe(false);
    expect(handle.current.progress.has(id)).toBe(false);
    // The upload in flight was aborted, and an aborted request still answers — so the answer
    // must not write a status onto an object a person has already thrown away.
    expect(uploads.calls[0]?.aborted).toBe(true);
    await settle();
    expect(board.images()[0]?.status).toBe('uploading');
  });

  it('lets go of a drag that carries no files', () => {
    const board = mount();
    const text = dragText();
    act(() => {
      board.handle.current.onDragOver(text);
    });
    // The browser keeps its own behaviour for text and links: the board neither claims the
    // gesture nor lights up the highlight.
    expect(text.preventDefault).not.toHaveBeenCalled();
    expect(board.handle.current.dropActive).toBe(false);
    expect(board.images()).toHaveLength(0);
  });

  it('shows the highlight while files are over the board, and hides it when they leave', () => {
    const board = mount();
    const { handle } = board;
    const files = drop([picture('one.png')]);

    act(() => {
      handle.current.onDragOver(files);
    });
    expect(handle.current.dropActive).toBe(true);

    // Moving from the board onto a note inside it is a leave event too, and not a leave of the
    // board: the highlight must not flicker as the cursor crosses what is already there.
    const inside = document.createElement('div');
    document.body.appendChild(inside);
    act(() => {
      handle.current.onDragLeave({ ...files, relatedTarget: inside });
    });
    expect(handle.current.dropActive).toBe(true);

    act(() => {
      handle.current.onDragLeave({ ...files, relatedTarget: null });
    });
    expect(handle.current.dropActive).toBe(false);
    expect(board.images()).toHaveLength(0);
  });
});

describe('adding images from the clipboard (story 12 · TC-18)', () => {
  it('leaves a paste alone when something is taking text (`image.paste`)', async () => {
    const board = mount();
    const editor = document.createElement('textarea');
    document.body.appendChild(editor);

    const event = paste([picture('one.png')], editor);
    act(() => {
      board.handle.current.onPaste(event);
    });
    await settle();

    // Pasting words into a note stays pasting words; not even preventDefault, so the caret
    // keeps the browser's own paste.
    expect(board.images()).toHaveLength(0);
    expect(uploads.calls).toHaveLength(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('does the same for a note whose label is being edited in place', async () => {
    const board = mount();
    const label = document.createElement('div');
    // The attribute, not the property: this is what React writes for `contentEditable`, and a
    // DOM without an editing engine has no opinion about the property.
    label.setAttribute('contenteditable', 'true');
    document.body.appendChild(label);

    act(() => {
      board.handle.current.onPaste(paste([picture('one.png')], label));
    });
    await settle();
    expect(board.images()).toHaveLength(0);
  });

  it('centres a pasted picture in the view, because a clipboard image has no point to land on', async () => {
    const board = mount();
    act(() => {
      board.handle.current.onPaste(paste([picture('one.png')], document.body));
    });
    await settle();

    const [image] = board.images();
    expect(image).toBeDefined();
    // The middle of the window is the middle of the board: the viewport fills it (`image.paste`).
    expect(image!.x + image!.width / 2).toBeCloseTo(window.innerWidth / 2, 5);
    expect(image!.y + image!.height / 2).toBeCloseTo(window.innerHeight / 2, 5);
    expect(image!.status).toBe('uploading');
  });

  it('ignores a paste that carries no files', async () => {
    const board = mount();
    const event = paste([], document.body);
    act(() => {
      board.handle.current.onPaste(event);
    });
    await settle();
    expect(board.images()).toHaveLength(0);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});

describe('adding images when the board is not up (story 12 · TC-19)', () => {
  for (const state of ['connecting', 'reconnecting', 'load_failed'] as const) {
    it(`refuses a drop while ${state}: one message, nothing added, nothing sent`, async () => {
      const board = mount({ connection: state });
      act(() => {
        board.handle.current.onDrop(drop([picture('one.png'), picture('two.jpg')]));
      });
      await settle();

      expect(activeToasts().map((toast) => toast.message)).toEqual([REJECTION_MESSAGES.offline]);
      expect(board.images()).toHaveLength(0);
      expect(uploads.calls).toHaveLength(0);
    });
  }

  it('refuses to open the picker rather than collecting a picture it cannot send', () => {
    const board = mount({ connection: 'reconnecting' });
    act(() => {
      board.handle.current.openPicker();
    });
    expect(activeToasts().map((toast) => toast.message)).toEqual([REJECTION_MESSAGES.offline]);
    // No file dialog was opened, so there is nothing waiting to be answered.
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('refuses a document that is not on a server at all', async () => {
    // A board with no id has nowhere to put bytes: the same message, for the same reason.
    const board = mount({ boardId: '' });
    act(() => {
      board.handle.current.onDrop(drop([picture('one.png')]));
    });
    await settle();
    expect(board.images()).toHaveLength(0);
    expect(uploads.calls).toHaveLength(0);
    expect(activeToasts().map((toast) => toast.message)).toEqual([REJECTION_MESSAGES.offline]);
  });
});

describe('refusing files that cannot be added (story 12 · TC-29)', () => {
  it('says which files were refused, and adds the ones that were not', async () => {
    const board = mount();
    act(() => {
      board.handle.current.onDrop(drop([wrongType(), picture('one.png')]));
    });
    await settle();

    expect(activeToasts().map((toast) => toast.message)).toEqual([REJECTION_MESSAGES.type]);
    // The good file from a mixed drop still arrives (`image.types`).
    expect(board.images()).toHaveLength(1);
    expect(uploads.calls).toHaveLength(1);
  });

  it('treats a file that will not decode as the unusable file it is, and adds nothing (TC-29)', async () => {
    stubDecoder((file) => file.name === 'corrupt.png');
    const board = mount();
    act(() => {
      board.handle.current.onDrop(drop([picture('corrupt.png')]));
    });
    await settle();

    expect(activeToasts().map((toast) => toast.message)).toEqual([REJECTION_MESSAGES.type]);
    expect(board.images()).toHaveLength(0);
    expect(uploads.calls).toHaveLength(0);
  });

  it('reports each kind of refusal once, however many files caused it', async () => {
    const board = mount();
    act(() => {
      board.handle.current.onDrop(drop([wrongType('a.pdf'), wrongType('b.pdf'), picture('one.png')]));
    });
    await settle();
    expect(activeToasts()).toHaveLength(1);
  });

  it('says nothing at all when the picker was opened and nothing chosen', async () => {
    const board = mount();
    act(() => {
      board.handle.current.openPicker();
    });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input?.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
    expect(input?.multiple).toBe(true);

    act(() => {
      fireEvent.change(input!, { target: { files: [] } });
    });
    await settle();
    expect(activeToasts()).toHaveLength(0);
    expect(board.images()).toHaveLength(0);
    // The input is taken out of the page again: a picker is not part of the board.
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('adds what the picker chose, centred in the view (`image.pick`)', async () => {
    const board = mount();
    act(() => {
      board.handle.current.openPicker();
    });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [picture('one.png'), picture('two.jpg')] });
    act(() => {
      fireEvent.change(input);
    });
    await settle();

    expect(board.images()).toHaveLength(2);
    // The row as a whole is centred in the view — the two pictures are of different heights, so
    // it is the row's box that sits on the middle, not each image's own (`image.layout`).
    const images = board.images();
    const left = Math.min(...images.map((image) => image.x));
    const top = Math.min(...images.map((image) => image.y));
    const right = Math.max(...images.map((image) => image.x + image.width));
    const bottom = Math.max(...images.map((image) => image.y + image.height));
    expect((left + right) / 2).toBeCloseTo(window.innerWidth / 2, 5);
    expect((top + bottom) / 2).toBeCloseTo(window.innerHeight / 2, 5);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
