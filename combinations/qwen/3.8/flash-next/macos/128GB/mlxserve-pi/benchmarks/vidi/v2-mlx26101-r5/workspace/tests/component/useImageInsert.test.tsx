/**
 * Getting a picture onto a board (story 12, TC-17 … TC-19).
 *
 * The hook under test has three doors and one flow behind them, so most of what is worth asserting is about
 * the doors: a drop knows where it was dropped and a paste does not, a paste that happens inside a text
 * field belongs to the text field, a picker that cannot upload says so instead of opening, and every one of
 * them refuses the same files for the same reasons. The flow behind them — validate, measure, place, upload
 * — is asserted here only where a door changes it, because a rule that lives in one place is best tested
 * once, and the arithmetic of placement and limits is in `tests/unit/`.
 *
 * Two things are stood in for, and both are stood in for because they cannot be had here rather than because
 * it was convenient:
 *
 * - **The upload** is `tests/component/helpers/fake-uploads.ts`, because a component test has to be able to
 *   say "the bar reached sixty per cent and then the request failed" *in that order*, and a real transfer
 *   answers when it likes.
 * - **The decoder** is a stub of `createImageBitmap`, which jsdom does not implement. This is the honest
 *   substitute for the real thing: the browser's own decoder is what tells the board how big a picture is,
 *   and a test that hands it dimensions is testing the placement of a size it was given, which is the
 *   question. That the real files in `tests/fixtures/images/` decode at all is what the end-to-end suite is
 *   for, in a browser that has a decoder behind that call.
 *
 * The document under every test is real, as is the undo discipline that comes with it: placeholders are
 * written with the board's own origin, in one transaction per batch, and what happens to the upload later is
 * not written by these doors at all.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

// The upload is the one thing in this flow a component test must be able to conduct: when it reports, when
// it answers, and whether it answers at all. Everything else here runs for real.
vi.mock('../../src/client/images/uploadImage', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  const helper = await import('./helpers/fake-uploads');
  return {
    ...actual,
    uploadImage: (boardId: string, file: File, onProgress: (fraction: number) => void) =>
      helper.fakeUploadImage(boardId, file, onProgress),
  };
});

import type { ClipboardEvent as ReactClipboardEvent, DragEvent as ReactDragEvent } from 'react';

import { initDoc, snapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_FILES_PER_ADD } from '../../src/shared/config';
import { isImageSnapshot, type ImageSnap } from '../../src/shared/objects/image';
import { screenToWorld, type Camera } from '../../src/client/canvas/camera';
import type { BoardStatus } from '../../src/client/board/connection';
import { useImageInsert, type ImageInsertControls } from '../../src/client/images/useImageInsert';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { clearToast, currentToast } from '../../src/client/ui/Toast';
import { createUndo } from '../../src/client/board/undo';
import { flush, uploadSpy } from './helpers/fake-uploads';

/** The camera every test mounts with: no pan and no zoom, so screen units and board units are one. */
const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/** The board the uploads are addressed to. */
const BOARD_ID = newBoardId();

/** Whose browser this is, for the two places a name decides what a person is told. */
const ME = 'Anna';

/** What the stub decoder answers for each file it is handed. */
const decoded = new WeakMap<File, { width: number; height: number }>();

/** A file with dimensions, which is the only way to hand this test a picture of a given size. */
function fileOf(name: string, type = 'image/png', size = { width: 800, height: 600 }): File {
  const file = new File([new Uint8Array(64)], name, { type });
  decoded.set(file, size);
  return file;
}

/** Files, in the shape the browser hands them to a handler. */
function fileList(files: readonly File[]): FileList {
  return Object.assign([...files], { item: (index: number) => files[index] ?? null });
}

/**
 * The decoder the board asks about a file: its dimensions, or a refusal.
 *
 * jsdom has no `createImageBitmap`, which is why this exists at all; the sizes come from the test and the
 * refusals are the interesting half, because a file that decodes to nothing is a file that must not be put
 * on a board.
 */
function stubDecoder(refuse: readonly File[] = []): void {
  globalThis.createImageBitmap = (async (input: Blob) => {
    const source = input as File;
    if (refuse.includes(source)) throw new Error('this file is not a picture');
    const size = decoded.get(source) ?? { width: 100, height: 100 };
    return { width: size.width, height: size.height, close(): void {} };
  }) as typeof createImageBitmap;
}

/**
 * A fabricated event, plus the one thing a fabricated event cannot report for itself: whether the handler
 * claimed it. jsdom's `DataTransfer` is not constructible, so the events this flow is driven with are made
 * by hand, and `defaultPrevented` therefore has to be kept by hand too. Real events — the paste events
 * further down, which are dispatched through a real DOM tree — are asserted with the real flag.
 */
interface Fabricated<E> {
  readonly event: E;
  /** Whether `preventDefault` was called. */
  prevented(): boolean;
}

function fabricated<E extends object>(fields: E): Fabricated<E> {
  const state = { prevented: false };
  const event = {
    ...fields,
    preventDefault(): void {
      state.prevented = true;
    },
  };
  return { event: event as E, prevented: () => state.prevented };
}

/** A drop: the files, the point, and the surface they were dropped on. */
function dropOf(files: readonly File[], at = { x: 100, y: 50 }): Fabricated<ReactDragEvent<HTMLElement>> {
  return fabricated({
    dataTransfer: { types: ['Files'], files: fileList(files), dropEffect: 'none' },
    clientX: at.x,
    clientY: at.y,
    currentTarget: document.createElement('div'),
  } as unknown as ReactDragEvent<HTMLElement>);
}

/** A drag of a selected piece of text, which is not files and not the board's business. */
function dragOfText(at = { x: 10, y: 10 }): Fabricated<ReactDragEvent<HTMLElement>> {
  return fabricated({
    dataTransfer: { types: ['text/plain'], files: fileList([]), dropEffect: 'none' },
    clientX: at.x,
    clientY: at.y,
    currentTarget: document.createElement('div'),
  } as unknown as ReactDragEvent<HTMLElement>);
}

/** A paste on the board itself, with files in the clipboard. */
function pasteOf(files: readonly File[]): Fabricated<ReactClipboardEvent<HTMLElement>> {
  return fabricated({
    target: document.body,
    clipboardData: { files: fileList(files) },
  } as unknown as ReactClipboardEvent<HTMLElement>);
}

/** What a mounted hook gives a test: the document, what is on it, the controls and the teardown. */
interface Mounted {
  readonly doc: Y.Doc;
  /** The pictures on the board, as the document holds them. */
  readonly images: ImageSnap[];
  readonly controls: ImageInsertControls;
  /** Lets the hook's asynchronous hops land, inside React's `act`. */
  settle(): Promise<void>;
  /** Takes the board down, which is what unmounting a board does to its uploads. */
  unmount(): void;
}

/** Mounts the hook over a board, the way the board mounts it. */
function mount(connection: BoardStatus = 'connected'): Mounted {
  const doc = new Y.Doc();
  initDoc(doc);
  const view = renderHook(() =>
    useImageInsert({ doc, boardId: BOARD_ID, camera: CAMERA, connection, identityId: ME }),
  );
  const controls = (): ImageInsertControls => {
    const current = view.result.current;
    if (current === null) throw new Error('the hook did not render');
    return current;
  };
  return {
    doc,
    get images(): ImageSnap[] {
      return snapshot(doc).filter(isImageSnapshot);
    },
    get controls(): ImageInsertControls {
      return controls();
    },
    async settle(): Promise<void> {
      await act(async () => {
        await flush();
      });
    },
    unmount(): void {
      act(() => {
        view.unmount();
      });
    },
  };
}

/** The middle of the screen this board is drawing, in board units. */
const viewCentre = (): { x: number; y: number } =>
  screenToWorld(CAMERA, { x: window.innerWidth / 2, y: window.innerHeight / 2 });

beforeEach(() => {
  uploadSpy.reset();
  clearToast();
  stubDecoder();
});

afterEach(() => {
  clearToast();
});

describe('a drop puts a row of pictures where it was dropped (TC-17)', () => {
  it('writes three placeholders and starts three uploads', async () => {
    const board = mount();
    const drop = dropOf([fileOf('a.png'), fileOf('b.jpg', 'image/jpeg'), fileOf('c.gif', 'image/gif')]);

    act(() => {
      board.controls.onDrop(drop.event);
    });
    await board.settle();

    expect(board.images).toHaveLength(3);
    expect(board.images.every((image) => image.status === 'uploading')).toBe(true);
    expect(drop.prevented()).toBe(true);
    expect(uploadSpy.count).toBe(3);
    expect(uploadSpy.calls.map((call) => call.boardId)).toEqual([BOARD_ID, BOARD_ID, BOARD_ID]);
    expect(board.images.map((image) => image.uploaderId)).toEqual([ME, ME, ME]);
  });

  it('puts the first picture’s corner exactly where the pointer was released', async () => {
    const board = mount();
    const at = { x: 320, y: 210 };
    const drop = dropOf([fileOf('a.png', 'image/png', { width: 1600, height: 1200 })], at);

    act(() => {
      board.controls.onDrop(drop.event);
    });
    await board.settle();

    const image = board.images[0];
    // "Here" means here: the drop's own point, in board units, is the placeholder's top-left corner.
    expect(image?.x).toBe(at.x);
    expect(image?.y).toBe(at.y);
    // and the box is already the size the picture will arrive at, so nothing on the board moves when it does.
    expect(image?.width).toBe(800);
    expect(image?.height).toBe(600);
    expect(image?.naturalWidth).toBe(1600);
  });

  it('runs the row to the right of the drop point, tops aligned and gap apart', async () => {
    const board = mount();
    const at = { x: 100, y: 50 };
    const drop = dropOf(
      [
        fileOf('a.png', 'image/png', { width: 400, height: 300 }),
        fileOf('b.png', 'image/png', { width: 200, height: 200 }),
        fileOf('c.png', 'image/png', { width: 100, height: 100 }),
      ],
      at,
    );

    act(() => {
      board.controls.onDrop(drop.event);
    });
    await board.settle();

    const [first, second, third] = board.images;
    expect([first?.y, second?.y, third?.y]).toEqual([at.y, at.y, at.y]);
    expect(second?.x).toBe((first?.x ?? 0) + (first?.width ?? 0) + IMAGE_LAYOUT_GAP_WORLD);
    expect(third?.x).toBe((second?.x ?? 0) + (second?.width ?? 0) + IMAGE_LAYOUT_GAP_WORLD);
    // Stacked in the order they were dropped, so none of them is hidden behind its own neighbours.
    expect(board.images.map((image) => image.z)).toEqual([1, 2, 3]);
  });

  it('reports progress as a number the uploader can see, and stops when the answer comes', async () => {
    const board = mount();
    act(() => {
      board.controls.onDrop(dropOf([fileOf('a.png')]).event);
    });
    await board.settle();

    const id = board.images[0]?.id as string;
    // Nothing has been reported yet, and the absence is what the uploader's box is drawn from.
    expect(board.controls.progress.has(id)).toBe(false);

    act(() => {
      uploadSpy.call(0).progress(0.4);
    });
    expect(board.controls.progress.get(id)).toBeCloseTo(0.4);

    act(() => {
      uploadSpy.call(0).progress(1);
    });
    expect(board.controls.progress.get(id)).toBeCloseTo(1);

    // The bytes arrived: the number goes away, because the transfer is over, and the document says what
    // happened instead. A percentage left behind would be a bar stuck at a hundred for good.
    act(() => {
      uploadSpy.call(0).succeed();
    });
    await board.settle();
    expect(board.controls.progress.has(id)).toBe(false);
    expect(board.images[0]?.status).toBe('ready');
    expect(board.images[0]?.assetKey).not.toBeNull();
  });

  it('marks the placeholder failed when the upload gives up, and keeps the file', async () => {
    const board = mount();
    act(() => {
      board.controls.onDrop(dropOf([fileOf('a.png')]).event);
    });
    await board.settle();

    const id = board.images[0]?.id as string;
    act(() => {
      uploadSpy.call(0).fail(500);
    });
    await board.settle();

    expect(board.images[0]?.status).toBe('failed');
    expect(board.images[0]?.assetKey).toBeNull();
    // The file is still in this tab's memory, which is the only reason a Retry can be offered at all.
    expect(board.controls.canRetry(id)).toBe(true);
  });

  it('sends the file it is holding when asked to retry, once, and not afterwards', async () => {
    const board = mount();
    act(() => {
      board.controls.onDrop(dropOf([fileOf('a.png')]).event);
    });
    await board.settle();

    const id = board.images[0]?.id as string;
    act(() => {
      uploadSpy.call(0).fail(0);
    });
    await board.settle();

    expect(board.controls.retry(id)).toBe(true);
    expect(uploadSpy.count).toBe(2);
    expect(board.images[0]?.status).toBe('uploading');

    act(() => {
      uploadSpy.call(1).succeed();
    });
    await board.settle();
    // The file has been delivered, so there is nothing left to send, and a button that could only answer "no"
    // would be a button worth hiding.
    expect(board.controls.canRetry(id)).toBe(false);
    expect(board.controls.retry(id)).toBe(false);
    expect(uploadSpy.count).toBe(2);
  });

  it('lets go of an upload still in the air when the board goes away', async () => {
    const board = mount();
    act(() => {
      board.controls.onDrop(dropOf([fileOf('a.png')]).event);
    });
    await board.settle();

    // A person who closes the tab mid-upload leaves nothing behind that could keep reporting into a document
    // nobody is holding any more.
    board.unmount();
    expect(uploadSpy.call(0).aborted).toBe(true);
  });
});

describe('a drag that carries no files is not the board’s business', () => {
  it('leaves a dragged selection to the browser', async () => {
    const board = mount();
    const drag = dragOfText();

    act(() => {
      board.controls.onDragOver(drag.event);
      board.controls.onDrop(drag.event);
    });
    await board.settle();

    // Preventing a drag of text would take the browser's own drag-and-drop away from the page for a story
    // that was only ever about files.
    expect(drag.prevented()).toBe(false);
    expect(uploadSpy.count).toBe(0);
    expect(board.images).toHaveLength(0);
    expect(currentToast()).toBeNull();
  });

  it('lets the browser have an empty drop', async () => {
    const board = mount();
    const drop = dropOf([]);
    act(() => {
      board.controls.onDrop(drop.event);
    });
    await board.settle();

    expect(uploadSpy.count).toBe(0);
    expect(board.images).toHaveLength(0);
    expect(currentToast()).toBeNull();
  });

  it('takes a drag of files as its own, and says the drop effect is a copy', () => {
    const board = mount();
    const drop = dropOf([fileOf('a.png')]);
    const transfer = (drop.event as unknown as { dataTransfer: { dropEffect: string } }).dataTransfer;

    act(() => {
      board.controls.onDragOver(drop.event);
    });

    expect(drop.prevented()).toBe(true);
    expect(transfer.dropEffect).toBe('copy');
  });
});

describe('a paste goes in the middle of what the person can see (TC-18)', () => {
  it('centres a pasted picture on the view, unlike a drop, which starts where the pointer was', async () => {
    const board = mount();
    act(() => {
      board.controls.onPaste(pasteOf([fileOf('a.png', 'image/png', { width: 400, height: 400 })]).event);
    });
    await board.settle();

    const centre = viewCentre();
    const image = board.images[0];
    // The picture's middle is the view's middle: a paste has no point of its own, so the board offers the
    // middle of what is on screen.
    expect(image?.x).toBeCloseTo(centre.x - (image?.width ?? 0) / 2);
    expect(image?.y).toBeCloseTo(centre.y - (image?.height ?? 0) / 2);
    expect(uploadSpy.count).toBe(1);
  });

  it('ignores a paste that happened inside a text field, and adds nothing', async () => {
    const board = mount();
    const editor = document.createElement('textarea');
    document.body.appendChild(editor);
    editor.focus();

    // A real paste event, bubbling out of the field that holds the caret — the only way to test that the
    // board noticed where the caret was rather than being told.
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(event, { clipboardData: { files: fileList([fileOf('screenshot.png')]) } });
    await act(async () => {
      editor.dispatchEvent(event);
      await flush();
    });

    // The field pastes its own text. The board writes nothing, uploads nothing and says nothing.
    expect(event.defaultPrevented).toBe(false);
    expect(board.images).toHaveLength(0);
    expect(uploadSpy.count).toBe(0);
    expect(currentToast()).toBeNull();

    editor.remove();
  });

  it('takes a paste on the board through the listener it installed itself', async () => {
    const board = mount();
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(event, { clipboardData: { files: fileList([fileOf('screenshot.png')]) } });

    await act(async () => {
      document.body.dispatchEvent(event);
      await flush();
    });

    expect(event.defaultPrevented).toBe(true);
    expect(board.images).toHaveLength(1);
  });

  it('says nothing about a paste of text, which is not a picture and not a problem', async () => {
    const board = mount();
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(event, { clipboardData: { files: fileList([]) } });

    await act(async () => {
      document.body.dispatchEvent(event);
      await flush();
    });

    expect(event.defaultPrevented).toBe(false);
    expect(board.images).toHaveLength(0);
    expect(uploadSpy.count).toBe(0);
    expect(currentToast()).toBeNull();
  });

  it('stops listening when the board goes away', async () => {
    const board = mount();
    board.unmount();

    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(event, { clipboardData: { files: fileList([fileOf('screenshot.png')]) } });
    document.body.dispatchEvent(event);
    await flush();

    expect(board.images).toHaveLength(0);
    expect(uploadSpy.count).toBe(0);
  });
});

describe('the picker says no instead of opening (TC-19)', () => {
  /** The input the hook made, or null when it never made one. */
  const picker = (): HTMLInputElement | null =>
    document.querySelector<HTMLInputElement>('input.image-picker-input');

  it('makes one input, filtered to the four types, and opens it', () => {
    const board = mount();
    act(() => {
      board.controls.openPicker();
    });

    const input = picker();
    expect(input).not.toBeNull();
    expect(input?.type).toBe('file');
    expect(input?.multiple).toBe(true);
    expect(input?.hidden).toBe(true);
    expect(input?.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
    expect(uploadSpy.count).toBe(0);
  });

  it('adds what was chosen, in the middle of the view', async () => {
    const board = mount();
    act(() => {
      board.controls.openPicker();
    });
    const input = picker() as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: fileList([fileOf('photo.jpg', 'image/jpeg')]), configurable: true });

    await act(async () => {
      input.dispatchEvent(new Event('change'));
      await flush();
    });

    const centre = viewCentre();
    expect(board.images).toHaveLength(1);
    expect(board.images[0]?.contentType).toBe('image/jpeg');
    expect(board.images[0]?.x).toBeCloseTo(centre.x - (board.images[0]?.width ?? 0) / 2);
    expect(uploadSpy.count).toBe(1);
  });

  it('opens empty next time: choosing the same file twice is two additions', async () => {
    const board = mount();
    act(() => {
      board.controls.openPicker();
    });
    const input = picker() as HTMLInputElement;

    Object.defineProperty(input, 'files', { value: fileList([fileOf('photo.jpg', 'image/jpeg')]), configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change'));
      await flush();
    });
    // The selection is emptied as it is taken, which is what makes the same file choosable twice. In a real
    // browser `input.value = ''` clears the selected files; jsdom will not accept a selection that was not
    // made by a real file picker, so what can be seen from here is the emptying itself.
    expect(input.value).toBe('');

    Object.defineProperty(input, 'files', { value: fileList([fileOf('photo.jpg', 'image/jpeg')]), configurable: true });
    await act(async () => {
      input.dispatchEvent(new Event('change'));
      await flush();
    });
    expect(board.images).toHaveLength(2);
  });

  it('takes the picker away again when the board goes away', () => {
    const board = mount();
    act(() => {
      board.controls.openPicker();
    });
    expect(picker()).not.toBeNull();
    board.unmount();
    expect(picker()).toBeNull();
  });

  for (const state of ['connecting', 'reconnecting', 'load_failed', 'invalid-board'] as BoardStatus[]) {
    it(`says the board’s own sentence while ${state}, and opens nothing`, async () => {
      const board = mount(state);
      const drop = dropOf([fileOf('a.png')]);

      act(() => {
        board.controls.openPicker();
      });
      expect(currentToast()?.text).toBe(REJECTION_MESSAGES.offline);
      // The picker is not opened and nothing is written: a file chosen now could never be uploaded, and a
      // picker that accepts a file and then refuses it is a picker that lied about opening.
      expect(picker()).toBeNull();

      act(() => {
        board.controls.onDrop(drop.event);
      });
      await board.settle();

      expect(drop.prevented()).toBe(true);
      expect(board.images).toHaveLength(0);
      expect(uploadSpy.count).toBe(0);
    });
  }

  it('refuses a drop while the line is down, and takes it once the line comes back', async () => {
    const offline = mount('reconnecting');
    act(() => {
      offline.controls.onDrop(dropOf([fileOf('a.png')]).event);
    });
    await offline.settle();

    expect(currentToast()?.text).toBe(REJECTION_MESSAGES.offline);
    expect(offline.images).toHaveLength(0);
    expect(uploadSpy.count).toBe(0);

    // A fresh mount, which is what the board is when the room reports a different state: the hook reads the
    // connection at the moment of the drop, not the one it was first given.
    const online = mount('connected');
    act(() => {
      online.controls.onDrop(dropOf([fileOf('a.png')]).event);
    });
    await online.settle();
    expect(online.images).toHaveLength(1);
    expect(uploadSpy.count).toBe(1);
  });
});

describe('what a batch of files becomes', () => {
  it('adds the supported files of a mixed drop and says what was refused', async () => {
    const board = mount();
    const good = fileOf('shot.png');
    const paperwork = new File([new Uint8Array(8)], 'report.pdf', { type: 'application/pdf' });

    act(() => {
      board.controls.onDrop(dropOf([paperwork, good]).event);
    });
    await board.settle();

    expect(board.images).toHaveLength(1);
    expect(currentToast()?.text).toBe(REJECTION_MESSAGES.type);
    expect(uploadSpy.count).toBe(1);
  });

  it('adds the first twenty of twenty-one and says the limit', async () => {
    const board = mount();
    const files = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, index) =>
      fileOf(`s-${index}.png`),
    );

    act(() => {
      board.controls.onDrop(dropOf(files).event);
    });
    await board.settle();

    expect(board.images).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(currentToast()?.text).toBe(REJECTION_MESSAGES.count);
  });

  it('refuses a file the decoder will not draw, and adds the ones beside it', async () => {
    // The case a name cannot catch and a size check cannot catch either: bytes that are not a picture, in a
    // file that insisted it was one. The message is the type message, because the type is the question the
    // decoder was asked.
    const board = mount();
    const corrupt = fileOf('broken.png');
    const good = fileOf('fine.png');
    stubDecoder([corrupt]);

    act(() => {
      board.controls.onDrop(dropOf([corrupt, good]).event);
    });
    await board.settle();

    expect(board.images).toHaveLength(1);
    expect(board.images[0]?.naturalWidth).toBe(800);
    expect(currentToast()?.text).toBe(REJECTION_MESSAGES.type);
    expect(uploadSpy.count).toBe(1);
  });

  it('adds nothing at all when every file in the batch was refused, and writes nothing to the document', async () => {
    const board = mount();
    act(() => {
      board.controls.onDrop(dropOf([new File([new Uint8Array(8)], 'notes.txt', { type: 'text/plain' })]).event);
    });
    await board.settle();

    expect(board.images).toHaveLength(0);
    expect(snapshot(board.doc)).toHaveLength(0);
    expect(uploadSpy.count).toBe(0);
  });

  it('writes a whole batch in one undo step, which is what one drop was', async () => {
    const board = mount();
    const history = createUndo(board.doc);
    const files = [fileOf('a.png'), fileOf('b.png'), fileOf('c.png')];

    act(() => {
      board.controls.onDrop(dropOf(files).event);
    });
    await board.settle();

    expect(board.images).toHaveLength(3);
    // One step for three pictures, seen from the door that made them: one press takes the whole drop back,
    // which is the same promise the model suite makes about the document, arriving through the gesture a
    // person actually performs.
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(board.images).toHaveLength(0);
    history.destroy();
  });
});
