/**
 * Handing the board a picture (TC-17 to TC-19, TC-29).
 *
 * `useImageInsert` is the flow between a person letting go of a file and a picture being on the board: is the board
 * reachable, which of these files does it take, how big is each picture, where do they go, and what happens while
 * the bytes are on their way. Those five questions are asked in order and each one has to be answered before the
 * next, which is why this is one hook and one set of tests rather than four places that each remember to check
 * whether the network is up.
 *
 *   - TC-17 — three files dropped are three images in a row, at the size each picture will be, arriving at the
 *     point the files were released; the uploader is told how far each upload has got, and each one becomes a
 *     picture when its upload finishes.
 *   - TC-18 — a paste belongs to whoever has the caret. A screenshot pasted into a note is text the note is being
 *     asked for, and the board does not get to decide otherwise; a screenshot pasted while the board has focus is
 *     the board's, and lands in the middle of what the person can see — the middle of the *screen*, because a
 *     clipboard carries no position to drop at.
 *   - TC-19 — a board that cannot be reached takes no pictures. Nothing is created, nothing is uploaded, and the
 *     one thing that happens is a sentence at the bottom of the screen.
 *   - TC-29 — a file that the browser cannot decode is a file that is not a picture, and is refused as one. The
 *     dimension check and the type check arrive at the same message because from where the person is standing they
 *     are the same fact, and the rest of the files in the same drop go on without it.
 *
 * The upload is mocked, because these are tests about a flow and not about a network: the mocked upload is a handle
 * the test reports progress through and settles when it wants to, which is the only way to look at a board in the
 * middle of an upload. The upload itself has its own tests, and the service that answers it has integration tests.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';

import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_FILES_PER_ADD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
} from '../../src/shared/config';
import { imageSnapshots, type ImageSnap } from '../../src/shared/objects/image';
import { CENTRE, doc, hasTextarea, noteElement, renderBoard, surface } from './helpers/stickyBoard';
import type { BoardConnector } from '../../src/client/board/useBoardDoc';
import { addNote, frameAtOrigin, rendered, WORLD_CENTRE } from './helpers/tools';
import { clearToasts, getToasts, TOAST_VISIBLE_MS } from '../../src/client/ui/Toast';

/**
 * The uploads this board has started, as the test sees them.
 *
 * `vi.hoisted`, because the mock below is hoisted out of this file by Vitest and runs before anything in it has
 * been declared: the list has to exist on the other side of that hoisting for the fake to have anywhere to put what
 * it is asked to upload.
 */
const fakes = vi.hoisted(() => {
  /** One upload the board asked for, and the three things a test can do to it. */
  const list: {
    file: File;
    boardId: string;
    aborted: boolean;
    report(fraction: number): void;
    succeed(assetKey: string): void;
    fail(status?: number): void;
  }[] = [];
  return {
    list,
    reset(): void {
      list.length = 0;
    },
    uploadImage(boardId: string, file: File, onProgress: (fraction: number) => void): unknown {
      let settle: (result: unknown) => void = () => {};
      const promise = new Promise<unknown>((resolve) => {
        settle = resolve;
      });
      const entry = {
        file,
        boardId,
        aborted: false,
        report: onProgress,
        succeed: (assetKey: string): void => {
          settle({ kind: 'ok', assetKey, contentType: 'image/png' });
        },
        fail: (status?: number): void => {
          settle({ kind: 'failed', status });
        },
      };
      list.push(entry);
      // The shape `uploadImage` really returns: a promise, and the way to stop it.
      return {
        promise,
        abort(): void {
          entry.aborted = true;
        },
      };
    },
  };
});

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (boardId: string, file: File, onProgress: (fraction: number) => void): unknown =>
    fakes.uploadImage(boardId, file, onProgress),
}));

/** A board the tab can reach, which is the board every one of these tests needs to be on. */
const reachable: BoardConnector = (_doc, _boardId, onState) => {
  onState('connected');
  return { destroy(): void {} };
};

/** A board that is trying. The difference between this and `reachable` is the whole of TC-19. */
const reconnecting: BoardConnector = (_doc, _boardId, onState) => {
  onState('reconnecting');
  return { destroy(): void {} };
};

/** A key in the shape the service would have given it. */
const KEY = 'vKd3xQ2mZ8rT7wL1nB4sY6/qW9tR2yU5iO8pA3sD6fG0z';

/**
 * The picture each file decodes to, by name.
 *
 * `createImageBitmap` is the only thing that can say how big a picture is, and jsdom does not have one — so these
 * tests provide it, and say what each file measures. Three shapes, so a row of them is not a row of identical boxes
 * and a test cannot pass by putting three copies of one size in a line.
 */
const DIMENSIONS: Record<string, { width: number; height: number }> = {
  'one.png': { width: 1200, height: 600 },
  'two.jpg': { width: 600, height: 1200 },
  'three.webp': { width: 800, height: 800 },
  'wide.gif': { width: 2400, height: 600 },
  'shot.png': { width: 1200, height: 600 },
};

function file(name: string, type: string, bytes = 32): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

function png(name = 'one.png'): File {
  return file(name, 'image/png');
}

/** The dimensions a board with no shim would have measured, for a file this file did not name. */
const DEFAULT_SIZE = { width: 1000, height: 500 };

beforeAll(() => {
  // The one shim, installed once for the file: the browser's decoder, answering with a size instead of pixels.
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    writable: true,
    value: async (source: Blob & { name?: string }) => {
      const name = source.name ?? '';
      if (name.startsWith('corrupt')) throw new Error('could not decode');
      const size = DIMENSIONS[name] ?? DEFAULT_SIZE;
      return { width: size.width, height: size.height, close(): void {} };
    },
  });
});

beforeEach(() => {
  fakes.reset();
  clearToasts();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Let whatever the board has started finish, and let React notice. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  });
}

function images(): ImageSnap[] {
  return [...imageSnapshots(doc())];
}

function said(): string[] {
  return getToasts().map((toast) => toast.text);
}

/** The one element inside one image, by what it is called in there. */
function inside(id: string, testId: string): HTMLElement | null {
  return document.querySelector(`[data-image-id="${id}"] [data-testid="${testId}"]`);
}

/**
 * Let go of some files over the board, at a screen point.
 *
 * Built by hand rather than with `fireEvent.drop`, because the event that fires has no `clientX` — and where the
 * files were released is the thing these tests are about. A browser sends a mouse event called `drop`, and hands it
 * a data transfer; this sends the same two things.
 */
function dropAt(at: { x: number; y: number }, files: File[]): void {
  dragEvent('drop', at, files, ['Files']);
}

/** What the browser calls each of the drag events the board answers. */
const DRAG_TYPES: Record<'drop' | 'dragEnter' | 'dragOver' | 'dragLeave', string> = {
  drop: 'drop',
  dragEnter: 'dragenter',
  dragOver: 'dragover',
  dragLeave: 'dragleave',
};

/** One of the drag events the board answers, with the position, the files and the types a browser would give it. */
function dragEvent(
  kind: 'drop' | 'dragEnter' | 'dragOver' | 'dragLeave',
  at: { x: number; y: number } = { x: 0, y: 0 },
  files: File[] = [],
  types: string[] = [],
  relatedTarget: EventTarget | null = null,
): void {
  // The name the browser uses, which is lowercase: a `MouseEvent` called `dragEnter` is a type of its own that
  // nobody is listening for, and the board would sit there not knowing a file was over it.
  const event = new MouseEvent(DRAG_TYPES[kind], {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
    relatedTarget,
  });
  Object.defineProperty(event, 'dataTransfer', { value: { files, types } });
  act(() => {
    surface().dispatchEvent(event);
  });
}

describe('dropping pictures on the board (TC-17)', () => {
  beforeEach(async () => {
    renderBoard(reachable);
    frameAtOrigin();
    await rendered();
  });

  it('TC-17: three files dropped are three pictures in a row, at the point they were released', async () => {
    dropAt({ x: 300, y: 200 }, [png('one.png'), file('two.jpg', 'image/jpeg'), file('three.webp', 'image/webp')]);

    // There they are, before a single byte has been uploaded: the board did not wait to find out whether the
    // upload would work before showing that it had been asked.
    await waitFor(() => expect(images().length).toBe(3));
    const placed = images();
    expect(placed.every((image) => image.status === 'uploading')).toBe(true);

    // A row, tops in a line, starting where the files were let go, with the space between them.
    expect(new Set(placed.map((image) => image.y))).toEqual(new Set([200]));
    expect(placed[0]?.x).toBe(300);
    expect(placed[1]?.x).toBe(300 + placed[0].width + IMAGE_LAYOUT_GAP_WORLD);
    expect(placed[2]?.x).toBe((placed[1]?.x ?? 0) + placed[1].width + IMAGE_LAYOUT_GAP_WORLD);

    // Each one is already the size its picture will be — the longest side at most the placement limit, and the
    // proportions the file's own — so nothing on the board moves when the bytes arrive.
    expect(placed[0]?.width).toBe(800);
    expect(placed[0]?.height).toBe(400);
    expect(placed[1]?.width).toBe(400);
    expect(placed[1]?.height).toBe(800);
    expect(Math.max(...placed.map((image) => Math.max(image.width, image.height)))).toBeLessThanOrEqual(
      IMAGE_MAX_PLACE_SIZE_WORLD,
    );
    expect(placed[0]?.naturalWidth).toBe(1200);
    expect(placed[0]?.naturalHeight).toBe(600);
    expect(placed[1]?.contentType).toBe('image/jpeg');
    // This tab's own, and named the way the document names this tab.
    expect(new Set(placed.map((image) => image.uploaderId))).toEqual(new Set([String(doc().clientID)]));

    // Three uploads, all started, none of them waiting for the last one to finish.
    expect(fakes.list.length).toBe(3);
    expect(fakes.list[0]?.file.name).toBe('one.png');
    expect(fakes.list[0]?.boardId).toBeTruthy();
  });

  it('TC-17: the person who dropped them is told how far each one has got, and they become pictures on their own', async () => {
    dropAt({ x: 100, y: 100 }, [png('one.png'), file('two.jpg', 'image/jpeg')]);
    await waitFor(() => expect(images().length).toBe(2));
    const [first, second] = images();

    // Half way for one of them, and only for that one: the two uploads are two uploads, and the bar on the first
    // is not the second's.
    await act(async () => {
      fakes.list[0]?.report(0.5);
    });
    await waitFor(() => expect(inside(first?.id ?? '', 'image-object-percent')?.textContent).toBe('50%'));
    // The other upload has started, and says the true thing about where it has got to.
    expect(inside(second?.id ?? '', 'image-object-percent')?.textContent).toBe('0%');
    // The percentage is said twice, once in a width and once in words.
    expect(inside(first?.id ?? '', 'image-object-progress')?.getAttribute('aria-valuenow')).toBe('50');

    // The first one arrives. The second is still on its way, and says so.
    await act(async () => {
      fakes.list[0]?.succeed(KEY);
    });
    await waitFor(() => expect(images()[0]?.status).toBe('ready'));
    expect(images()[0]?.assetKey).toBe(KEY);
    expect(inside(first?.id ?? '', 'image-object-progress')).toBeNull();
    expect(inside(first?.id ?? '', 'image-object-percent')).toBeNull();
    // A stored picture is asked for: the box now has the address in it.
    expect(inside(first?.id ?? '', 'image-object-img')).not.toBeNull();

    expect(images()[1]?.status).toBe('uploading');
    await act(async () => {
      fakes.list[1]?.report(0.25);
    });
    await waitFor(() => expect(inside(second?.id ?? '', 'image-object-percent')?.textContent).toBe('25%'));
  });

  it('TC-17: an upload that did not make it is a failed picture, and the reason is written down', async () => {
    // The board writes the status to its console; this test is about it doing so, so the console is listened to
    // rather than shouted over.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    dropAt({ x: 100, y: 100 }, [png('one.png')]);
    await waitFor(() => expect(images().length).toBe(1));
    const [image] = images();

    await act(async () => {
      fakes.list[0]?.fail(500);
    });
    await waitFor(() => expect(images()[0]?.status).toBe('failed'));

    // The state is in the document, which is the only reason the other four people on the board hear about it.
    expect(images()[0]?.assetKey).toBeNull();
    expect(inside(image?.id ?? '', 'image-object-retry')).not.toBeNull();
    expect(inside(image?.id ?? '', 'image-object-remove')).not.toBeNull();
    expect(errors.mock.calls.map((call) => String(call[0])).join('')).toContain('500');
    errors.mockRestore();
  });

  it('TC-17: the outline says the board will take these files, and goes away when it has them', async () => {
    const files = [png('one.png')];
    await settle();

    dragEvent('dragEnter', { x: 10, y: 10 }, [], ['Files']);
    await waitFor(() => expect(screen.getByTestId('drop-highlight')).not.toBeNull());
    // A drag over is what makes a drop possible at all; the board answers it and keeps the outline up.
    dragEvent('dragOver', { x: 20, y: 20 }, [], ['Files']);
    expect(screen.getByTestId('drop-highlight')).not.toBeNull();

    // A drag of the board's own objects — a note being moved about — is not a file drag, and does not get an
    // outline about pictures.
    dragEvent('dragLeave', { x: 30, y: 30 }, [], [], document.body);
    await waitFor(() => expect(screen.queryByTestId('drop-highlight')).toBeNull());
    dragEvent('dragEnter', { x: 40, y: 40 }, [], ['text/plain']);
    await settle();
    expect(screen.queryByTestId('drop-highlight')).toBeNull();

    dragEvent('dragEnter', { x: 50, y: 50 }, [], ['Files']);
    await waitFor(() => expect(screen.getByTestId('drop-highlight')).not.toBeNull());
    dropAt({ x: 400, y: 400 }, files);
    // The outline is gone the moment the files are the board's problem, and the picture is on the board.
    await waitFor(() => expect(screen.queryByTestId('drop-highlight')).toBeNull());
    await waitFor(() => expect(images().length).toBe(1));
  });

  it('TC-17: twenty-one files is twenty pictures and one sentence about the rest', async () => {
    const many = Array.from({ length: IMAGE_MAX_FILES_PER_ADD + 1 }, (_unused, index) =>
      file(`many-${index}.png`, 'image/png'),
    );

    dropAt({ x: 0, y: 0 }, many);

    await waitFor(() => expect(images().length).toBe(IMAGE_MAX_FILES_PER_ADD));
    // The limit is a cut and not a refusal: the files that fit went in, and the person is told about the one
    // that did not, once rather than twenty times.
    expect(said()).toContain(`Only ${IMAGE_MAX_FILES_PER_ADD} images can be added at once.`);
    expect(fakes.list.length).toBe(IMAGE_MAX_FILES_PER_ADD);
  });

  it('TC-17: dropping nothing is not an event about pictures', async () => {
    // A drop with no files in it — a text drop, a dragged link — is not the board's business at all.
    fireEvent.drop(surface(), { dataTransfer: { files: [], types: ['Files'] }, clientX: 10, clientY: 10 });
    await settle();

    expect(images().length).toBe(0);
    expect(fakes.list.length).toBe(0);
    expect(said()).toEqual([]);
  });
});

describe('pasting a picture (TC-18)', () => {
  beforeEach(async () => {
    renderBoard(reachable);
    frameAtOrigin();
    await rendered();
  });

  it('TC-18: a paste into a note is the note’s, and puts nothing on the board', async () => {
    addNote(WORLD_CENTRE);
    fireEvent.doubleClick(noteElement(), { clientX: CENTRE.x, clientY: CENTRE.y });
    await waitFor(() => expect(hasTextarea()).toBe(true));

    // A screenshot, pasted into a note that is open for typing. The note was asked for; the board was not.
    fireEvent.paste(textArea(), { clipboardData: { files: [png('shot.png')] } });
    await settle();

    expect(images().length).toBe(0);
    expect(fakes.list.length).toBe(0);
    expect(said()).toEqual([]);
    // The note is still open for typing, which is where the paste went.
    expect(hasTextarea()).toBe(true);
  });

  it('TC-18: a paste with the board in front is the board’s, and lands in the middle of what is on screen', async () => {
    // Nothing has the focus: the paste starts on the page, which is the board's own surface.
    fireEvent.paste(document.body, { clipboardData: { files: [png('shot.png')] } });
    await waitFor(() => expect(images().length).toBe(1));

    const image = images()[0];
    if (image === undefined) throw new Error('the pasted picture did not arrive');
    // The middle of the visible area, not the top-left of it, and not the world's origin: a clipboard carries no
    // position, so the only place there is to put it is in front of the person who pasted it.
    expect(image.x + image.width / 2).toBeCloseTo(CENTRE.x, 0);
    expect(image.y + image.height / 2).toBeCloseTo(CENTRE.y, 0);
    expect(image.status).toBe('uploading');
  });

  it('TC-18: a paste of text is left for whatever the browser would have done with it', async () => {
    fireEvent.paste(document.body, { clipboardData: { files: [] } });
    await settle();

    expect(images().length).toBe(0);
    expect(said()).toEqual([]);
  });
});

/** The note's editor, which is where a paste that is not the board's has to start. */
function textArea(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
}

describe('a board that cannot be reached (TC-19)', () => {
  beforeEach(async () => {
    renderBoard(reconnecting);
    frameAtOrigin();
    await rendered();
  });

  it('TC-19: nothing is added while the board is reconnecting, by any of the three ways in', async () => {
    const expected = "You’re offline — images can be added when you reconnect.";

    dropAt({ x: 200, y: 200 }, [png('one.png')]);
    await settle();
    expect(images().length).toBe(0);

    fireEvent.paste(document.body, { clipboardData: { files: [png('shot.png')] } });
    await settle();
    expect(images().length).toBe(0);

    // The third way in: the file window. It is not opened at all — a window that can only end in a refusal is
    // worse than no window — so the board is asked and says no before the person is asked anything.
    fireEvent.click(screen.getByRole('button', { name: /Image/ }));
    await settle();

    expect(images().length).toBe(0);
    expect(fakes.list.length).toBe(0);
    // The sentence, and only once per way in rather than once per file: three refusals about the same offline
    // board is three sentences saying one thing.
    expect(said()).toContain(expected);
    expect(screen.getAllByRole('status').length).toBeGreaterThanOrEqual(1);
  });

  it('TC-19: the sentence about being offline is the one the board promises, in the place it promises it', async () => {
    // The offline answer needs no clock at all — it is given before anything is awaited — which is what lets the
    // whole of this test be run on a clock the test moves.
    vi.useFakeTimers();
    dropAt({ x: 200, y: 200 }, [png('one.png')]);

    const toast = screen.getByTestId('toast');
    expect(toast.textContent).toBe("You’re offline — images can be added when you reconnect.");
    // A status and not an alert: it is read out in the screen reader's own time, and it must not interrupt a
    // person who is in the middle of saying something.
    expect(toast.getAttribute('role')).toBe('status');

    // And it goes away by itself, because a refusal about a board that has come back is news about a moment that
    // has passed by the time anybody has read it. The clock is moved rather than waited out.
    await act(async () => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS + 1);
    });
    expect(getToasts().length).toBe(0);
  });

  it('TC-19: being offline is not a reason to refuse a file, which is what the toast is for', async () => {
    // The order matters: the board is asked before the files are looked at, so a person who drops twelve files
    // while reconnecting is told one true thing rather than twelve half-true ones.
    dropAt({ x: 1, y: 1 }, [file('bad.pdf', 'application/pdf'), file('big.png', 'image/png', 10 * 1024 * 1024 + 1)]);
    await settle();

    expect(said()).toEqual(["You’re offline — images can be added when you reconnect."]);
    expect(images().length).toBe(0);
  });
});

describe('a file that is not a picture (TC-29)', () => {
  beforeEach(async () => {
    renderBoard(reachable);
    frameAtOrigin();
    await rendered();
  });

  it('TC-29: a file the browser cannot decode is refused as the wrong type, and the rest of the drop goes on', async () => {
    // A PDF renamed `.png` arrives with the browser's own type set straight, and is refused before anything is
    // asked of it. A WebP truncated on the way to the clipboard has the right name and the wrong bytes, and is
    // refused by the only thing that can tell — the decoder.
    dropAt({ x: 100, y: 100 }, [file('report.pdf', 'application/pdf'), file('corrupt.png', 'image/png')]);
    await settle();

    expect(images().length).toBe(0);
    expect(fakes.list.length).toBe(0);
    // One message, because the two refusals are the same news: this is not a picture the board can draw.
    expect(said()).toEqual(['Only PNG, JPEG, GIF and WebP images can be added.']);
  });

  it('TC-29: the good files in a bad drop are not held up by the bad ones', async () => {
    dropAt({ x: 100, y: 100 }, [file('corrupt.png', 'image/png'), png('one.png')]);

    await waitFor(() => expect(images().length).toBe(1));
    expect(images()[0]?.naturalWidth).toBe(1200);
    // The picture arrives in the first position of the row: the row is made of the files the board took, and the
    // one it refused did not leave a hole in it.
    expect(images()[0]?.x).toBe(100);
    expect(said()).toEqual(['Only PNG, JPEG, GIF and WebP images can be added.']);
  });

  it('TC-29: a file too big for the board is refused by size, and said so by size', async () => {
    dropAt({ x: 0, y: 0 }, [file('big.png', 'image/png', 10 * 1024 * 1024 + 1), png('one.png')]);

    await waitFor(() => expect(images().length).toBe(1));
    // Both refusals are said, in the order a person would want them: what it is, then how big it is.
    expect(said()).toEqual(['Images must be 10 MB or smaller.']);
    expect(fakes.list.length).toBe(1);
  });

  it('TC-29: a picture that is refused was never uploaded, and a byte of it was never sent', async () => {
    dropAt({ x: 0, y: 0 }, [file('report.pdf', 'application/pdf')]);
    await settle();

    expect(fakes.list.length).toBe(0);
    // Nothing was created for it either, so there is nothing on the board to be waiting for an upload that is
    // never going to come.
    expect(images().length).toBe(0);
    expect(doc().getMap('objects').size).toBe(0);
  });
});
