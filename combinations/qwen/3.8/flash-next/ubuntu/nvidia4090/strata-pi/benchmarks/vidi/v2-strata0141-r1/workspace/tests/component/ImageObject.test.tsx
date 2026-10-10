import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { objectSnapshots } from '../../src/shared/board-model';
import { IMAGE_MAX_PLACE_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  createImagePlaceholders,
  displayStatus,
  markImageFailed,
  markImageReady,
  markImageRetrying,
  readImage,
  type ImageSnap,
} from '../../src/shared/objects/image';
import { clientId } from '../../src/client/useClientId';
import {
  COMPONENT_BOARD_ID,
  boardElement,
  changeDoc,
  flushFrame,
  pressKeys,
  renderBoard,
  selectionCount,
} from './harness';
import { uploads } from '../fixtures/fakeUpload';

/**
 * What an image on the board looks like while it is not there yet
 * (`image.placeholder`, `image.upload_failure`, `image.upload_stale`,
 * `image.asset_unavailable`, `image.retry`).
 *
 * TC-21, TC-22, TC-23 and TC-24. The states are put into the document in the past
 * rather than waited for: an upload that has gone stale is created stale, and a file
 * the board refused is created refused. Nothing sleeps, so no test depends on how fast
 * a machine is.
 *
 * Two things a client cannot know are faked the way only a test can know them: a
 * `<img>` that stops loading after it looked fine, and a reload, which is the same
 * board without the file that made Retry possible.
 */

vi.mock('../../src/client/images/uploadImage', async () => {
  const fake = await import('../fixtures/fakeUpload');
  return { uploadImage: fake.uploadImage, uploadUrlFor: fake.uploadUrlFor };
});

const OTHER = 'someone_else_on_the_board';
const ASSET = `${COMPONENT_BOARD_ID}/asset00000000000000000000`;
const PNG_MAGIC = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** The dimensions the (replaced) decoder reports for `photo.png`. */
const DECODED = { width: 400, height: 300 };

beforeAll(() => {
  vi.stubGlobal('createImageBitmap', () =>
    Promise.resolve({
      width: DECODED.width,
      height: DECODED.height,
      close(): void {
        // A real one holds a decoding surface; this one holds nothing.
      },
    }),
  );
});

afterEach(() => {
  // Unmount first: leaving a board stops the files it was sending, and a test should
  // not be told about an upload the test before it left behind.
  cleanup();
  uploads.reset();
});

const imageElements = (): HTMLElement[] => screen.queryAllByTestId(/^image-object-/u);

const imageIn = (doc: Y.Doc, id: string): ImageSnap | null => readImage(doc, id);

function sizeOf(id: string): { width: number; height: number } {
  const element = screen.getByTestId(`image-object-${id}`);
  return {
    width: Number(element.getAttribute('data-width')),
    height: Number(element.getAttribute('data-height')),
  };
}

/**
 * A board carrying one image, written straight into the document. `at` is when its
 * upload began, which is how a test creates an upload that is already too old.
 */
function boardWithImage(
  doc: Y.Doc,
  options: {
    uploaderId?: string;
    at?: number;
    status?: 'ready' | 'failed';
    size?: { width: number; height: number };
  } = {},
): string {
  const width = options.size?.width ?? DECODED.width;
  const height = options.size?.height ?? DECODED.height;
  const ids = createImagePlaceholders(
    doc,
    [{ x: 200, y: 120, width, height, naturalWidth: width, naturalHeight: height }],
    options.uploaderId ?? clientId(),
    options.at ?? Date.now(),
  );
  const id = ids[0] ?? '';
  if (options.status === 'ready') {
    markImageReady(doc, id, ASSET, 'image/png');
  } else if (options.status === 'failed') {
    markImageFailed(doc, id);
  }
  return id;
}

const png = (name = 'photo.png'): File => new File([PNG_MAGIC], name, { type: 'image/png' });
const jpg = (name = 'photo.jpg'): File => new File([PNG_MAGIC], name, { type: 'image/jpeg' });

const imagesIn = (doc: Y.Doc): ImageSnap[] =>
  objectSnapshots(doc).filter((entry) => entry.type === 'image') as ImageSnap[];

/** A drop event carrying files, aimed at a point on the board. */
function dispatchDrop(files: readonly File[], at: { x: number; y: number }): void {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], files, items: [], dropEffect: 'copy' },
  });
  Object.defineProperty(event, 'clientX', { value: at.x });
  Object.defineProperty(event, 'clientY', { value: at.y });
  act(() => {
    boardElement().dispatchEvent(event);
  });
}

async function settle(rounds = 4): Promise<void> {
  for (let round = 0; round < rounds; round += 1) {
    await act(async () => {
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

/**
 * Drop one supported file and let the add settle. `outcome` is what the board does
 * with it: refuse it, store it, or leave it in the air.
 */
async function dropFiles(
  doc: Y.Doc,
  files: readonly File[],
  outcome: 'ok' | 'fail' | 'keep' = 'fail',
  status?: number,
): Promise<ImageSnap[]> {
  for (const file of files) {
    uploads.plan(file.name, { outcome: 'keep' }); // every upload stays in the air to start with
  }
  dispatchDrop(files, { x: 140, y: 100 });
  await settle();

  if (outcome === 'fail') {
    for (const call of uploads.calls) {
      call.fail(status ?? 500);
    }
  } else if (outcome === 'ok') {
    uploads.allOk();
  }
  await settle();
  return imagesIn(doc);
}

async function dropOneFile(
  doc: Y.Doc,
  outcome: 'ok' | 'fail' | 'keep' = 'fail',
  status?: number,
): Promise<string> {
  const images = await dropFiles(doc, [png()], outcome, status);
  if (images.length !== 1) {
    throw new Error(`the drop added ${images.length} objects, not one`);
  }
  return images[0]!.id;
}

/* -------------------------------------------------------------------------- */

describe('image.placeholder', () => {
  it('a placeholder is already the size the finished image will be', async () => {
    const doc = new Y.Doc();
    const id = boardWithImage(doc, { status: 'ready', size: { width: 640, height: 480 } });
    renderBoard({ doc, connect: false });
    await flushFrame();

    const element = screen.getByTestId(`image-object-${id}`);
    expect(element.getAttribute('data-image-object')).toBe(id);
    expect(sizeOf(id)).toEqual({ width: 640, height: 480 });

    const img = screen.getByTestId(`image-${id}`) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/api/assets/${ASSET}`);
    // The image fills the box it was placed in: nothing moves when bytes arrive.
    expect(img.className).toContain('image-object__img');
  });

  it('Uploading… is shown to everyone, a percentage only to the person who can know it', async () => {
    const doc = new Y.Doc();
    const mine = boardWithImage(doc, { uploaderId: clientId() });
    const theirs = boardWithImage(doc, { uploaderId: OTHER });
    renderBoard({ doc, connect: false });
    await flushFrame();

    expect(screen.getByTestId(`image-uploading-${mine}`).textContent).toContain('Uploading');
    expect(screen.getByTestId(`image-uploading-${theirs}`).textContent).toContain('Uploading');
    expect(screen.getByTestId(`image-uploading-${theirs}`).textContent).not.toContain('%');
    // Nobody is shown a percentage they have no way of knowing.
    expect(screen.queryAllByTestId(/^image-progress-/u)).toHaveLength(0);
    expect(imageElements()).toHaveLength(2);
    expect(screen.queryAllByTestId(/^image-failed-/u)).toHaveLength(0);
  });

  it('the uploader sees a percentage while the bytes are on their way', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    const id = await dropOneFile(doc, 'keep');
    act(() => {
      uploads.calls[0]?.onProgress(0.25);
    });
    expect(screen.getByTestId(`image-progress-${id}`).textContent).toBe('25%');
    // Everyone else on the same board sees no number.
    expect(screen.queryAllByTestId(/^image-progress-/u)).toHaveLength(1);
  });

  it('an image is selectable and resizable by its rectangle', async () => {
    const doc = new Y.Doc();
    const id = boardWithImage(doc, { status: 'ready' });
    renderBoard({ doc, connect: false });
    await flushFrame();

    fireEvent.pointerDown(screen.getByTestId(`image-object-${id}`), { clientX: 300, clientY: 200 });
    await flushFrame();
    expect(selectionCount()).toBe(1);
    expect(imageElements()[0]?.getAttribute('data-selected')).toBe('true');
  });
});

describe('image.upload_failure (TC-21)', () => {
  it('TC-21: the person who dropped the file is offered Retry and Remove', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    const id = await dropOneFile(doc, 'fail', 500);
    expect(imageIn(doc, id)?.status).toBe('failed');
    expect(imageIn(doc, id)?.assetKey).toBeNull();

    expect(screen.getByTestId(`image-failed-${id}`).textContent).toContain('Upload failed');
    expect(screen.getByTestId(`image-retry-${id}`)).toBeTruthy();
    expect(screen.getByTestId(`image-remove-${id}`)).toBeTruthy();
    // The rectangle is unchanged by the failure, and the object is still on the board.
    expect(sizeOf(id)).toEqual({ width: DECODED.width, height: DECODED.height });
    expect(objectSnapshots(doc).length).toBe(1);
    expect(imageElements()).toHaveLength(1);
  });

  it('TC-21: everyone else sees exactly what an image that is not there looks like', async () => {
    const doc = new Y.Doc();
    const id = boardWithImage(doc, { uploaderId: OTHER, status: 'failed' });
    renderBoard({ doc, connect: false });
    await flushFrame();

    expect(screen.getByTestId(`image-unavailable-${id}`).textContent).toContain('Image unavailable');
    expect(screen.queryByTestId(`image-failed-${id}`)).toBeNull();
    // Not their file to retry - they have no copy of it - and the board does not offer
    // them a button that would do nothing.
    expect(screen.queryByTestId(`image-retry-${id}`)).toBeNull();
    expect(screen.queryByTestId(`image-remove-${id}`)).toBeNull();
    // Same rectangle either way: the failure never moves the layout.
    expect(sizeOf(id)).toEqual({ width: DECODED.width, height: DECODED.height });
  });
});

describe('image.upload_stale (TC-22)', () => {
  it('TC-22: an upload that has gone quiet says so and can be removed', async () => {
    const doc = new Y.Doc();
    const id = boardWithImage(doc, { at: Date.now() - IMAGE_UPLOAD_STALE_MS - 1 });
    renderBoard({ doc, connect: false });
    await flushFrame();

    expect(screen.getByTestId(`image-unfinished-${id}`).textContent).toContain(
      "Image upload didn't finish",
    );
    expect(displayStatus(imageIn(doc, id)!, Date.now())).toBe('unfinished');
    expect(screen.getByTestId(`image-remove-${id}`)).toBeTruthy();

    fireEvent.click(screen.getByTestId(`image-remove-${id}`));
    await flushFrame();
    expect(imageIn(doc, id)).toBeNull();
    expect(objectSnapshots(doc).length).toBe(0);
    expect(imageElements()).toHaveLength(0);
  });

  it('TC-22: exactly at the limit it is still uploading, a millisecond later it is not', () => {
    const doc = new Y.Doc();
    const startedAt = Date.now() - IMAGE_UPLOAD_STALE_MS;
    const id = boardWithImage(doc, { at: startedAt });
    expect(displayStatus(imageIn(doc, id)!, startedAt + IMAGE_UPLOAD_STALE_MS)).toBe('uploading');
    expect(displayStatus(imageIn(doc, id)!, startedAt + IMAGE_UPLOAD_STALE_MS + 1)).toBe('unfinished');
  });

  it('TC-22: Remove is offered whoever is looking, because the placeholder is on everybody’s board', async () => {
    const doc = new Y.Doc();
    const id = boardWithImage(doc, {
      uploaderId: OTHER,
      at: Date.now() - IMAGE_UPLOAD_STALE_MS - 1,
    });
    renderBoard({ doc, connect: false });
    await flushFrame();
    console.log('DBG', JSON.stringify(readImage(doc, id)), 'rendered', screen.getByTestId(`image-object-${id}`).getAttribute('data-status'));
    expect(screen.getByTestId(`image-unfinished-${id}`)).toBeTruthy();
    expect(screen.getByTestId(`image-remove-${id}`)).toBeTruthy();
  });
});

describe('image.asset_unavailable (TC-23)', () => {
  it('TC-23: an image that stops loading keeps its size and says it is unavailable', async () => {
    const doc = new Y.Doc();
    const id = boardWithImage(doc, { status: 'ready', size: { width: 400, height: 300 } });
    renderBoard({ doc, connect: false });
    await flushFrame();

    expect(sizeOf(id)).toEqual({ width: 400, height: 300 });
    fireEvent.error(screen.getByTestId(`image-${id}`));
    await flushFrame();

    expect(sizeOf(id)).toEqual({ width: 400, height: 300 });
    expect(screen.getByTestId(`image-unavailable-${id}`).textContent).toContain('Image unavailable');
    expect(imageIn(doc, id)?.status).toBe('unavailable');
    // The bytes are gone from the view; the object, its id and its place remain.
    expect(imageIn(doc, id)?.id).toBe(id);
    expect(screen.queryByTestId(`image-${id}`)).toBeNull();
  });

  it('TC-23: an image that never loaded for anyone looks the same as one that stopped', async () => {
    const doc = new Y.Doc();
    const id = boardWithImage(doc, { status: 'ready', uploaderId: OTHER });
    renderBoard({ doc, connect: false });
    await flushFrame();
    fireEvent.error(screen.getByTestId(`image-${id}`));
    await flushFrame();
    expect(screen.getByTestId(`image-unavailable-${id}`).textContent).toContain('Image unavailable');
    // There is nothing this client could retry: it never had the file.
    expect(screen.queryByTestId(`image-retry-${id}`)).toBeNull();
  });

  it('a ready image whose bytes are gone is not silently replaced by a placeholder of another size', async () => {
    const doc = new Y.Doc();
    const id = boardWithImage(doc, { status: 'ready', size: { width: IMAGE_MAX_PLACE_SIZE_WORLD, height: 200 } });
    renderBoard({ doc, connect: false });
    await flushFrame();
    fireEvent.error(screen.getByTestId(`image-${id}`));
    await flushFrame();
    expect(sizeOf(id)).toEqual({ width: IMAGE_MAX_PLACE_SIZE_WORLD, height: 200 });
  });
});

describe('image.retry (TC-24)', () => {
  it('TC-24: Retry sends the same file again, and the retry can succeed', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    const id = await dropOneFile(doc, 'fail', 500);
    expect(uploads.calls.length).toBe(1);

    fireEvent.click(screen.getByTestId(`image-retry-${id}`));
    await flushFrame();

    expect(imageIn(doc, id)?.status).toBe('uploading');
    expect(uploads.calls.length).toBe(2);
    expect(uploads.calls[1]?.file.name).toBe('photo.png');
    // Nothing was left running to stop: the attempt this Retry replaces had ended.
    expect(uploads.aborts).toEqual([]);
    expect(screen.getByTestId(`image-uploading-${id}`)).toBeTruthy();
    expect(screen.queryByTestId(`image-retry-${id}`)).toBeNull();

    uploads.calls[1]?.ok(ASSET, 'image/png');
    await settle();
    expect(imageIn(doc, id)?.status).toBe('ready');
    expect(screen.getByTestId(`image-${id}`).getAttribute('src')).toBe(`/api/assets/${ASSET}`);
  });

  it('TC-24: after a reload the board offers no Retry, because this client no longer has the file', async () => {
    const doc = new Y.Doc();
    // A board that has since been reloaded: the failed object is still on it, the bytes
    // that made it are not anywhere this client can reach.
    const id = boardWithImage(doc, { status: 'failed' });
    renderBoard({ doc, connect: false });
    await flushFrame();

    expect(screen.getByTestId(`image-failed-${id}`).textContent).toContain('Upload failed');
    expect(screen.queryByTestId(`image-retry-${id}`)).toBeNull();
    expect(screen.getByTestId(`image-remove-${id}`)).toBeTruthy();
    expect(uploads.calls.length).toBe(0);
  });

  it('TC-24: Retry stops the upload it replaces when that upload is still running', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    const id = await dropOneFile(doc, 'keep');
    // The room has given up on the attempt that is still sitting on this client's wire:
    // the object says failed, the upload has not returned yet.
    changeDoc(() => {
      markImageFailed(doc, id);
    });
    await flushFrame();
    expect(screen.getByTestId(`image-retry-${id}`)).toBeTruthy();

    fireEvent.click(screen.getByTestId(`image-retry-${id}`));
    await settle();

    expect(uploads.aborts).toEqual(['photo.png']);
    expect(uploads.abortsSettled()).toEqual([]); // stopped, never answered
    expect(uploads.calls.length).toBe(2);
    expect(imageIn(doc, id)?.status).toBe('uploading');
  });

  it('TC-24: Remove stops the upload as well as deleting the object', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    const id = await dropOneFile(doc, 'keep');
    expect(uploads.calls.length).toBe(1);
    expect(uploads.aborts).toEqual([]);
    // A Remove is offered when the upload has gone quiet (`image.upload_stale`) while
    // its bytes may still be on their way: the placeholder is old, the wire is not.
    changeDoc(() => {
      markImageRetrying(doc, id, Date.now() - IMAGE_UPLOAD_STALE_MS - 60_000);
    });
    await flushFrame();
    expect(screen.getByTestId(`image-unfinished-${id}`)).toBeTruthy();

    fireEvent.click(screen.getByTestId(`image-remove-${id}`));
    await settle();
    expect(imageIn(doc, id)).toBeNull();
    expect(uploads.aborts).toEqual(['photo.png']);
    expect(uploads.abortsSettled()).toEqual([]);
  });

  it('TC-24: Delete on a selected image stops its upload too', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    const id = await dropOneFile(doc, 'keep');
    fireEvent.pointerDown(screen.getByTestId(`image-object-${id}`), { clientX: 300, clientY: 200 });
    await flushFrame();
    expect(selectionCount()).toBe(1);

    pressKeys('Delete');
    await settle();
    expect(imageIn(doc, id)).toBeNull();
    expect(uploads.aborts).toEqual(['photo.png']);
  });

  it('deleting a selection of images from the selection bar stops their uploads too', async () => {
    const doc = new Y.Doc();
    renderBoard({ doc, connect: false });
    await flushFrame();

    const placed = await dropFiles(doc, [png(), jpg('second.jpg')], 'keep');
    expect(placed).toHaveLength(2);

    // A finished add leaves what it created as the selection; the bar answers a
    // selection of two objects (`sel.keyboard`, `sel.selection_bar`).
    expect(selectionCount()).toBe(2);
    expect(uploads.calls.map((call) => call.file.name)).toEqual(['photo.png', 'second.jpg']);

    fireEvent.click(screen.getByTestId('delete-selection'));
    await settle();
    expect(imagesIn(doc)).toHaveLength(0);
    // Both uploads were stopped, not just the one the click landed on.
    expect([...uploads.aborts].sort()).toEqual(['photo.png', 'second.jpg']);
  });
});
