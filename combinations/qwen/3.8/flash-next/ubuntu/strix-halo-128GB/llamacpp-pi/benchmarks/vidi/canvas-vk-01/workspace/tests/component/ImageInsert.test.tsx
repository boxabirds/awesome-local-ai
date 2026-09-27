import { screen, within } from '@testing-library/react';
import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as Y from 'yjs';

import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_FILES_PER_ADD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
} from '../../src/shared/config';
import { objectSnapshots } from '../../src/shared/board-model';
import type { ImageSnap } from '../../src/shared/objects/image';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { jpegBytes, pngBytes } from '../fixtures/image-bytes';
import { imageFile } from '../fixtures/image-files';
import { fireKey } from './helpers';
import {
  chooseFiles,
  fireDrag,
  firePaste,
  flushed,
  renderImageBoard,
  restoreDecode,
  stubDecode,
  stubDecodeFailure,
  uploadSpy,
  type UploadCall,
} from './image-helpers';

vi.mock('../../src/client/images/uploadImage', async () => {
  const { uploadImageMock } = await import('./image-upload-spy');
  return uploadImageMock() as never;
});

// A stand-in socket, so TC-19 can put the board into `reconnecting` the way a
// dropped connection does rather than by reaching into a component's state.
const fake = vi.hoisted(() => {
  const instances: FakeProviderInstance[] = [];
  class FakeWebsocketProvider {
    handlers = new Map<string, Set<(arg: never) => void>>();
    destroyed = false;
    constructor(
      readonly serverUrl: string,
      readonly roomname: string,
      readonly doc: unknown,
      readonly options: unknown,
    ) {
      instances.push(this as unknown as FakeProviderInstance);
    }
    on(event: string, handler: (arg: never) => void): void {
      const set = this.handlers.get(event) ?? new Set();
      set.add(handler);
      this.handlers.set(event, set);
    }
    off(event: string, handler: (arg: never) => void): void {
      this.handlers.get(event)?.delete(handler);
    }
    emit(event: string, arg: unknown): void {
      for (const handler of [...(this.handlers.get(event) ?? [])]) {
        (handler as (a: unknown) => void)(arg);
      }
    }
    disconnect(): void {}
    destroy(): void {
      this.destroyed = true;
    }
  }
  return { instances, provider: FakeWebsocketProvider };
});

interface FakeProviderInstance {
  emit(event: string, arg: unknown): void;
}

vi.mock('y-websocket', () => ({ WebsocketProvider: fake.provider }));

/**
 * Adding images to the board — `image.drop`, `image.paste`, `image.pick`,
 * `image.types`, `image.size_limit`, `image.count_limit`, `image.place_size`,
 * `image.offline`, `image.rate_limit`.
 *
 * The network is replaced and the decoder is told what each picture's own size
 * is; everything else — the doc, the validation, the placement, the toasts — is
 * the application's.
 */

const BOARD_ID = 'V1a2b3c4D5e6F7g8h9i0j-';

const png = (name = 'shot.png'): File => imageFile(name, 'image/png', pngBytes());

const imagesIn = (doc: Y.Doc): ImageSnap[] =>
  objectSnapshots(doc).filter((entry): entry is ImageSnap => entry.type === 'image');

/**
 * Which placeholder an upload belongs to: the batch is placed in the order the
 * files arrived and every file starts uploading in that same order.
 */
const idOf = (doc: Y.Doc, call: UploadCall): string =>
  imagesIn(doc)[uploadSpy.calls.indexOf(call)]!.id;

beforeEach(() => {
  uploadSpy.reset();
  fake.instances.length = 0;
  stubDecode({ width: 1200, height: 800 });
});

afterEach(() => {
  cleanup();
  restoreDecode();
});

describe('TC-17: dropping files onto the board', () => {
  it('places a row of placeholders at the drop point, shows progress, then the picture', async () => {
    const board = renderImageBoard();
    const files = [png('a.png'), png('b.png'), png('c.png')];

    fireDrag(board.viewport, 'dragenter', files);
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();
    fireDrag(board.viewport, 'dragover', files, { x: 140, y: 95 });
    expect(screen.queryByTestId('drop-highlight')).toBeTruthy();

    const event = fireDrag(board.viewport, 'drop', files, { x: 120, y: 90 });
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    await flushed();

    const placed = imagesIn(board.doc);
    expect(placed).toHaveLength(3);
    expect(placed.every((image) => image.status === 'uploading')).toBe(true);
    // Across from the drop point, tops level with it, the named gap between
    // (`image.drop`, `image.place_size`).
    expect(placed[0]!.x).toBe(120);
    expect(placed[1]!.x).toBe(placed[0]!.x + placed[0]!.width + IMAGE_LAYOUT_GAP_WORLD);
    expect(placed[2]!.x).toBe(placed[1]!.x + placed[1]!.width + IMAGE_LAYOUT_GAP_WORLD);
    for (const image of placed) expect(image.y).toBe(90);
    // 1200x800 reduced to the cap on its longest side, keeping its proportions.
    expect(placed[0]!.width).toBe(IMAGE_MAX_PLACE_SIZE_WORLD);
    expect(placed[0]!.height).toBe(
      Math.round((IMAGE_MAX_PLACE_SIZE_WORLD * 800) / 1200),
    );

    expect(uploadSpy.calls).toHaveLength(3);
    const first = uploadSpy.calls[0] as UploadCall;
    const id = idOf(board.doc, first);

    // The uploader watches the bytes go (`image.uploading`).
    uploadSpy.emit(first, 0.4);
    const box = screen.getByTestId(`image-object-${id}`);
    expect(within(box).getByText('40%')).toBeTruthy();

    await uploadSpy.settle(first, { kind: 'ok', assetKey: `${BOARD_ID}/asset-1` });
    expect(imagesIn(board.doc).find((image) => image.id === id)?.status).toBe('ready');
    const img = (await screen.findByTestId(`image-object-${id}`)) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe(`/api/assets/${BOARD_ID}/asset-1`);
    expect(img.getAttribute('alt')).toBe('Image');
    // The other two are untouched: an upload answers only for itself.
    expect(imagesIn(board.doc).filter((image) => image.status === 'uploading')).toHaveLength(2);
  });

  it('leaves a drag that carries no files alone', () => {
    const board = renderImageBoard();
    const event = fireDrag(board.viewport, 'drop', []);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    expect(imagesIn(board.doc)).toHaveLength(0);
  });
});

describe('TC-18: pasting', () => {
  it('adds a pasted image to the middle of the view', async () => {
    const board = renderImageBoard();

    firePaste([png('clip.png')]);
    await flushed();

    const placed = imagesIn(board.doc);
    expect(placed).toHaveLength(1);
    // The camera is at the origin at zoom 1, so the middle of the board is the
    // world origin and the row is centred on it.
    expect(placed[0]!.x).toBeCloseTo(-placed[0]!.width / 2, 5);
    expect(uploadSpy.calls).toHaveLength(1);
  });

  it('is not an image request while a text editor has focus', async () => {
    const board = renderImageBoard();
    const editor = document.createElement('textarea');
    board.container.appendChild(editor);

    firePaste([png('clip.png')], editor);
    await flushed();

    expect(imagesIn(board.doc)).toHaveLength(0);
    expect(uploadSpy.calls).toHaveLength(0);
  });

  it('leaves a text paste to the text editor', async () => {
    const board = renderImageBoard();
    const event = firePaste(null);
    expect(event.defaultPrevented).toBe(false);
    expect(imagesIn(board.doc)).toHaveLength(0);
  });
});

describe('TC-19: the board cannot be reached', () => {
  it('refuses the drop, creates nothing, uploads nothing', async () => {
    const board = renderImageBoard({ boardId: BOARD_ID });
    const provider = fake.instances[fake.instances.length - 1] as FakeProviderInstance;
    act(() => provider.emit('status', { status: 'connected' }));
    act(() => provider.emit('sync', true));
    act(() => provider.emit('status', { status: 'disconnected' }));

    fireDrag(board.viewport, 'drop', [png()], { x: 50, y: 50 });
    await flushed();

    expect(await screen.findByText(REJECTION_MESSAGES.offline)).toBeTruthy();
    expect(imagesIn(board.doc)).toHaveLength(0);
    expect(uploadSpy.calls).toHaveLength(0);
  });
});

describe('TC-20: the picker, and the server answering 429', () => {
  it('adds what the picker chose and explains being too quick', async () => {
    const board = renderImageBoard();
    const input = screen.getByTestId('image-file-input') as HTMLInputElement;
    expect(input.getAttribute('accept')).toBe('image/png,image/jpeg,image/gif,image/webp');
    expect(input.multiple).toBe(true);

    chooseFiles(input, [png('picked.png')]);
    await flushed();

    expect(imagesIn(board.doc)).toHaveLength(1);
    expect(uploadSpy.calls).toHaveLength(1);

    await uploadSpy.settle(uploadSpy.calls[0] as UploadCall, { kind: 'rate_limited' });
    expect(imagesIn(board.doc)[0]!.status).toBe('failed');
    expect(await screen.findByText(REJECTION_MESSAGES.rate)).toBeTruthy();
  });

  it('opens the picker from the Image button and from I, staying on Select', () => {
    renderImageBoard();
    const input = screen.getByTestId('image-file-input');
    const click = vi.spyOn(input, 'click');

    screen.getByTestId('tool-image').click();
    expect(click).toHaveBeenCalledTimes(1);

    fireKey({ key: 'i' });
    expect(click).toHaveBeenCalledTimes(2);

    // The Image tool never becomes the current tool (`image.pick`).
    expect(screen.getByTestId('tool-select').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('TC-29: a file that is not a picture', () => {
  it('refuses what the browser cannot decode and places nothing', async () => {
    const board = renderImageBoard();
    stubDecodeFailure();

    firePaste([png('corrupt.png')]);
    await flushed();

    expect(await screen.findByText(REJECTION_MESSAGES.type)).toBeTruthy();
    expect(imagesIn(board.doc)).toHaveLength(0);
    expect(uploadSpy.calls).toHaveLength(0);
  });
});

describe('TC-21 to TC-24: what a batch refuses on the way in', () => {
  it('says each reason once and adds the file that was acceptable', async () => {
    const board = renderImageBoard();

    firePaste([
      png('ok.png'),
      imageFile('big.jpg', 'image/jpeg', new Uint8Array(IMAGE_MAX_BYTES + 1)),
      imageFile('plan.pdf', 'application/pdf', jpegBytes()),
    ]);
    await flushed();

    expect(await screen.findByText(REJECTION_MESSAGES.size)).toBeTruthy();
    expect(screen.getByText(REJECTION_MESSAGES.type)).toBeTruthy();
    expect(screen.queryByText(REJECTION_MESSAGES.count)).toBeNull();
    expect(imagesIn(board.doc)).toHaveLength(1);
    expect(uploadSpy.calls).toHaveLength(1);
  });

  it('adds the first twenty of twenty-five and says there were too many', async () => {
    const board = renderImageBoard();

    firePaste(Array.from({ length: 25 }, (_unused, index) => png(`shot-${index}.png`)));
    await flushed();

    expect(await screen.findByText(REJECTION_MESSAGES.count)).toBeTruthy();
    expect(imagesIn(board.doc)).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
    expect(uploadSpy.calls).toHaveLength(IMAGE_MAX_FILES_PER_ADD);
  });
});
