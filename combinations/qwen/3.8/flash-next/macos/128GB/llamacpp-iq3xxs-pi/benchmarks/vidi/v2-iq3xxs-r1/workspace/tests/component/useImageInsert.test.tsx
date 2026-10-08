import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Board } from '../../src/client/board/Board';
import { clearToasts } from '../../src/client/ui/Toast';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { assetUrl } from '../../src/client/images/uploadImage';
import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_LAYOUT_GAP_WORLD, IMAGE_MAX_BYTES } from '../../src/shared/config';
import { TEST_BOARD_ID, dispatchKey, flushFrame, flushUntil } from './util';
import {
  clickEmptyBoard,
  createUnselectedNote,
  dispatchDblClick,
  clickWithPointer,
  noteEl,
  press,
} from './stickyUtil';
import { FakeProvider } from './fake-sync';
import { fakeAssetKey, uploadFake, uploadFor } from './imageUploadFake';
import {
  dragFilesAway,
  dragFilesOnto,
  dropFiles,
  dropTargetInWorld,
  fixtures,
  imageEls,
  imageSnaps,
  imageStatus,
  installImageBitmapStub,
  pasteFiles,
  toastTexts,
} from './imageUtil';

/** A stored picture's address, shaped like the server's own keys. */
const READY_KEY = fakeAssetKey(TEST_BOARD_ID, 'photo-1');

/* The network is not what these tests are about (design "Mock vs real boundaries":
   *`uploadImage` mocked with controllable progress*), so every upload goes to a recorder
   that answers when the test says so. `assetUrl` stays real: the picture's `src` is part
   of what is asserted. */
vi.mock('../../src/client/images/uploadImage', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/client/images/uploadImage')>(
      '../../src/client/images/uploadImage',
    );
  const { uploadFake: fake } = await import('./imageUploadFake');
  return {
    ...actual,
    uploadImage: (boardId: string, file: File, onProgress: (fraction: number) => void) =>
      fake.upload(boardId, file, onProgress),
  };
});

/**
 * Story 12 — getting images onto the board (image.drop, image.paste, image.pick,
 * image.insert, image.types, image.size_limit, image.count_limit, image.offline).
 *
 * Three doors, one path, and a document that shows the result. A `File` and a
 * `dataTransfer` cannot be produced by jsdom's browser APIs, so the doors are handed
 * plain events carrying the fields the handlers read (see `imageUtil`), and a stub of
 * `createImageBitmap` answers as Chromium answers for the same bytes. Everything else is
 * the real thing: the document, the placeholders in it, the undo boundaries, the toasts.
 */

beforeAll(() => {
  installImageBitmapStub();
});

beforeEach(() => {
  uploadFake.reset();
  clearToasts();
});

describe('drop (image.drop, image.uploading)', () => {
  // TC-17: three files at once — three placeholders in a row at the drop point, filling
  // in as progress arrives, then pictures in the same boxes.
  it('TC-17: three dropped files become three placeholders in a row, then three pictures', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const files = await fixtures('photo.png', 'animated.gif', 'photo.webp');

    dropFiles(files, { x: 120, y: 140 });
    await flushFrame();
    await flushUntil(() => imageSnaps().length === 3);

    // Every file became an object, in a row whose first top-left corner is the drop
    // point, tops aligned and separated by the layout gap (TC-04's shape, on screen).
    const origin = dropTargetInWorld({ x: 120, y: 140 });
    const snaps = imageSnaps();
    expect(snaps).toHaveLength(3);
    expect(snaps[0]!.x).toBeCloseTo(origin.x, 6);
    expect(snaps[0]!.y).toBeCloseTo(origin.y, 6);
    for (let i = 1; i < snaps.length; i++) {
      const before = snaps[i - 1]!;
      const image = snaps[i]!;
      expect(image.x).toBeCloseTo(before.x + before.width + IMAGE_LAYOUT_GAP_WORLD, 6);
      expect(image.y).toBeCloseTo(origin.y, 6);
    }
    // Each box is already the picture's own shape, scaled to the placement limit.
    expect(snaps.map((image) => [image.width, image.height])).toEqual([
      [120, 90],
      [4, 4],
      [640, 480],
    ]);
    expect(snaps.every((image) => image.status === 'uploading')).toBe(true);
    expect(uploadFake.started).toHaveLength(3);
    expect(uploadFake.started.map((upload) => upload.file.name)).toEqual(files.map((file) => file.name));

    // All three boxes say they are uploading, and anyone looking at the document sees the
    // same three placeholders before a byte has landed (PRD image.shared).
    expect(imageEls()).toHaveLength(3);
    expect(screen.getAllByTestId('image-placeholder')).toHaveLength(3);
    expect(screen.getAllByTestId('image-status').map((el) => el.textContent)).toEqual([
      'Uploading… 0%',
      'Uploading… 0%',
      'Uploading… 0%',
    ]);

    // Progress comes from the upload, and is seen by the tab that is sending it.
    await act(async () => {
      uploadFor(0).progress(0.4);
    });
    await flushUntil(() => imageStatus(0).includes('40%'));
    const bars = screen.getAllByTestId('image-progress');
    expect(bars).toHaveLength(3); // every placeholder says where it is; these two at 0%
    expect(bars.map((bar) => bar.getAttribute('aria-valuenow'))).toEqual(['40', '0', '0']);

    // Storage answered: the placeholder becomes the picture, in the same box.
    await act(async () => {
      uploadFor(0).succeed(READY_KEY);
    });
    await flushUntil(() => imageSnaps().some((image) => image.status === 'ready'));
    const pictures = screen.getAllByTestId('image-picture');
    expect(pictures).toHaveLength(1);
    expect(pictures[0]!.getAttribute('src')).toBe(assetUrl(READY_KEY));
    const readyNow = imageSnaps().find((image) => image.status === 'ready')!;
    const readyBox = imageEls().find((el) => el.dataset.status === 'ready');
    expect(readyBox?.dataset.imageId).toBe(readyNow.id);

    // The other two are still placeholders.
    expect(screen.getAllByTestId('image-placeholder')).toHaveLength(2);
  });

  it('shows the drop highlight while files are over the board and hides it when they leave', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const files = await fixtures('photo.png');
    expect(screen.queryByTestId('drop-highlight')).toBeNull();

    dragFilesOnto(files);
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();

    // Leaving is not a refusal and adds nothing; it was only ever a highlight.
    dragFilesAway(files);
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    expect(imageSnaps()).toHaveLength(0);
  });

  it('a drop of something that carries no files is not the board’s business', () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const event = dropFiles([]);
    expect(event.defaultPrevented).toBe(false); // the browser may do what it likes with it
    expect(imageSnaps()).toHaveLength(0);
  });
});

describe('paste (image.paste)', () => {
  // TC-18: a paste during text editing belongs to the editor; one the board holds lands
  // in the middle of what you can see.
  it('TC-18: adds nothing while a note is being edited, and centres its row when the board has the keyboard', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    await createUnselectedNote('Faster onboarding');
    clickWithPointer(noteEl(0));
    dispatchDblClick(noteEl(0));
    const editor = screen.getByTestId('sticky-note-input');

    const files = await fixtures('photo.png');
    pasteFiles(files, editor);
    await flushFrame();
    expect(imageSnaps()).toHaveLength(0);
    expect(uploadFake.started).toHaveLength(0);
    expect(toastTexts()).toHaveLength(0); // quietly the editor's, not a refusal

    // Out of the editor the same paste is the board's: one image, in the middle of the
    // visible area.
    await press('{Escape}');
    clickEmptyBoard();
    pasteFiles(files);
    await flushFrame();
    await flushUntil(() => imageSnaps().length === 1);

    const image = imageSnaps()[0]!;
    const centre = dropTargetInWorld({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    expect(image.x + image.width / 2).toBeCloseTo(centre.x, 6);
    expect(image.y + image.height / 2).toBeCloseTo(centre.y, 6);
  });

  it('a paste with no image in it is left to whatever else it was for', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const event = pasteFiles([]);
    await flushFrame();
    expect(event.defaultPrevented).toBe(false);
    expect(imageSnaps()).toHaveLength(0);
  });
});

describe('the Image tool’s picker (image.pick)', () => {
  it('the Image button opens a picker that only offers the accepted types', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    fireEvent.click(screen.getByTestId('tool-image'));

    const input = document.body.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input!.getAttribute('accept')).toBe('image/png,image/jpeg,image/gif,image/webp');
    expect((input as HTMLInputElement).multiple).toBe(true);

    // Choosing files adds them the way a drop does — centred, since nothing was pointed
    // at, and the picker is not left lying around for the next click.
    const files = await fixtures('photo.png');
    Object.defineProperty(input, 'files', { value: files });
    act(() => {
      input!.dispatchEvent(new Event('change'));
    });
    await flushFrame();
    await flushUntil(() => imageSnaps().length === 1);
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
    expect(imageSnaps()[0]!.x + imageSnaps()[0]!.width / 2).toBeCloseTo(
      dropTargetInWorld({ x: window.innerWidth / 2, y: window.innerHeight / 2 }).x,
      6,
    );
  });

  it('the I key opens it too, and a cancelled picker adds nothing', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    dispatchKey({ key: 'i' });
    const input = document.body.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    act(() => {
      input!.dispatchEvent(new Event('cancel'));
    });
    await flushFrame();
    expect(imageSnaps()).toHaveLength(0);
    expect(document.body.querySelector('input[type="file"]')).toBeNull();
  });
});

describe('refusals (image.types, image.size_limit, image.count_limit, image.offline)', () => {
  // TC-19: an unreachable board adds nothing at all — no object, no upload — and says so.
  it('TC-19: while reconnecting a drop says offline, and no object or upload appears', async () => {
    const provider = new FakeProvider();
    render(<Board boardId={newBoardId()} sync connect={{}} provider={provider} />);
    act(() => {
      provider.emitStatus('connecting');
      provider.emitStatus('connected');
      provider.emitSync(true);
    });
    expect(screen.queryByTestId('connection-status')).toBeNull();

    // The socket dropped. The board is still there to read, and nothing can be added.
    act(() => provider.emitStatus('disconnected'));
    expect(screen.getByTestId('connection-status').getAttribute('data-state')).toBe('reconnecting');

    const files = await fixtures('photo.png');
    dropFiles(files);
    await flushFrame();
    await flushFrame();

    expect(toastTexts()).toEqual([REJECTION_MESSAGES.offline]);
    expect(imageSnaps()).toHaveLength(0);
    expect(uploadFake.started).toHaveLength(0);
  });

  // The design's decode-failure path: an `<img>` of this file would show a torn picture,
  // so it is refused instead, in the same words as any other wrong type.
  it('TC-29: a file the browser cannot decode is refused as a type, and never uploaded', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const files = await fixtures('corrupt.png');

    dropFiles(files);
    await flushFrame();
    await flushUntil(() => toastTexts().length > 0);

    expect(toastTexts()).toEqual([REJECTION_MESSAGES.type]);
    expect(imageSnaps()).toHaveLength(0);
    expect(uploadFake.started).toHaveLength(0);
  });

  it('a batch that mixes good and bad files adds the good ones and explains the rest', async () => {
    render(<Board boardId={TEST_BOARD_ID} sync={false} />);
    const tooBig = new File([new Uint8Array(IMAGE_MAX_BYTES + 1)], 'huge.png', { type: 'image/png' });
    const files = await fixtures('photo.png', 'fake.png');

    dropFiles([files[0]!, files[1]!, tooBig]);
    await flushFrame();
    await flushUntil(() => imageSnaps().length === 1);
    await flushUntil(() => toastTexts().length === 2);

    expect(imageSnaps()).toHaveLength(1);
    expect(uploadFake.started.map((upload) => upload.file.name)).toEqual(['photo.png']);
    // One sentence per reason, in a fixed order, whatever the batch was: the PDF named
    // .png and the 10 MB+1 file are explained, and the good file is on the board.
    expect(toastTexts()).toEqual([REJECTION_MESSAGES.type, REJECTION_MESSAGES.size]);
  });
});
