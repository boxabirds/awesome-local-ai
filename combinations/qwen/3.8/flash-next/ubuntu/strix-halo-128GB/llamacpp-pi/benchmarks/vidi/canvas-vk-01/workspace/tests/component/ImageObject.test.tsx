import { fireEvent, screen, within } from '@testing-library/react';
import { act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IMAGE_MIN_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { objectSnapshots } from '../../src/shared/board-model';
import type { ImageSnap } from '../../src/shared/objects/image';
import { T0, UPLOADER_ID, seedImage, type SeedImage } from '../fixtures/image-objects';
import { pngBytes } from '../fixtures/image-bytes';
import { imageFile } from '../fixtures/image-files';
import {
  fireDrag,
  flushed,
  renderImageBoard,
  restoreDecode,
  stubDecode,
  uploadSpy,
  type UploadCall,
} from './image-helpers';

vi.mock('../../src/client/images/uploadImage', async () => {
  const { uploadImageMock } = await import('./image-upload-spy');
  return uploadImageMock() as never;
});

/**
 * How an image shows itself (`image.uploading`, `image.shared`,
 * `image.upload_failure`, `image.unfinished`, `image.unavailable`) — the same
 * record drawn differently for the client that is sending it and for everyone
 * else, and read the same way by everyone once the bytes have arrived.
 *
 * This client's identity is fixed through the session storage key the identity
 * hook uses, so "the uploader" and "someone else" are both testable on one board.
 */

// Set before the first render, which is when the identity hook decides who this
// browser is (`uploader-1`), and it stays that id for the file.
globalThis.sessionStorage?.setItem('vidi6-identity', UPLOADER_ID);

const OTHER_ID = 'someone-else-1';

const imageIn = (doc: Y.Doc, id: string): ImageSnap =>
  objectSnapshots(doc).find((entry) => entry.id === id) as ImageSnap;

beforeEach(() => {
  uploadSpy.reset();
  stubDecode({ width: 400, height: 300 });
});

afterEach(() => {
  cleanup();
  restoreDecode();
});

describe('TC-21: a failed upload', () => {
  it('offers the uploader the bytes it still holds', async () => {
    const board = renderImageBoard();
    fireDrag(board.viewport, 'drop', [imageFile('shot.png', 'image/png', pngBytes())], {
      x: 0,
      y: 0,
    });
    await flushed();
    const id = imageId(board.doc, 0);

    await uploadSpy.settle(uploadSpy.calls[0] as UploadCall, { kind: 'failed', status: 500 });

    const box = screen.getByTestId(`image-object-${id}`);
    expect(box.getAttribute('data-status')).toBe('failed');
    expect(within(box).getByText('Upload failed')).toBeTruthy();
    expect(within(box).getByTestId(`image-retry-${id}`)).toBeTruthy();
    expect(within(box).getByTestId(`image-remove-${id}`)).toBeTruthy();
  });

  it('shows a viewer with no bytes of their own a plain unavailable box', () => {
    const doc = seedDoc({ status: 'failed', uploaderId: OTHER_ID });
    const board = renderImageBoard({ doc });
    const id = imageId(board.doc, 0);

    const box = screen.getByTestId(`image-object-${id}`);
    expect(box.getAttribute('data-status')).toBe('failed');
    expect(within(box).getByText('Image unavailable')).toBeTruthy();
    expect(within(box).queryByTestId(`image-retry-${id}`)).toBeNull();
    expect(within(box).queryByTestId(`image-remove-${id}`)).toBeNull();
  });
});

describe('TC-22: an upload nobody is reporting on', () => {
  it('says it did not finish, to anyone, and Remove takes it away', () => {
    const doc = seedDoc({ status: 'uploading', uploadStartedAt: T0, uploaderId: OTHER_ID });
    const board = renderImageBoard({ doc });
    const id = imageId(board.doc, 0);
    // Older than the stale window, so this is a fact about the record and not a
    // guess about the clock.
    expect(Date.now() - T0).toBeGreaterThan(IMAGE_UPLOAD_STALE_MS);

    const box = screen.getByTestId(`image-object-${id}`);
    expect(box.getAttribute('data-status')).toBe('unfinished');
    expect(within(box).getByText("Image upload didn't finish")).toBeTruthy();

    fireEvent.click(within(box).getByTestId(`image-remove-${id}`));
    expect(objectSnapshots(board.doc).find((entry) => entry.id === id)).toBeUndefined();
  });

  it('turns a live upload into an unfinished one on the clock alone', async () => {
    // Started just under the limit: the component sets its own alarm for the
    // moment the upload stops being believable, without the user doing anything.
    const started = Date.now() - IMAGE_UPLOAD_STALE_MS + 400;
    const doc = seedDoc({ status: 'uploading', uploadStartedAt: started, uploaderId: OTHER_ID });
    const board = renderImageBoard({ doc });
    const id = imageId(board.doc, 0);

    const box = () => screen.getByTestId(`image-object-${id}`);
    expect(box().getAttribute('data-status')).toBe('uploading');
    // Nothing else happens on this board: no click, no peer message, no progress.
    // The component's own alarm is what makes the upload stop being believable, so
    // this waits for the box to change of its own accord.
    await act(async () => {
      const deadline = Date.now() + 2_000;
      while (box().getAttribute('data-status') !== 'unfinished' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    });
    expect(box().getAttribute('data-status')).toBe('unfinished');
  });
});

describe('TC-23: a stored image that will not load', () => {
  it('keeps its box and says the picture is unavailable', () => {
    const doc = seedDoc({ status: 'ready', uploaderId: OTHER_ID });
    const board = renderImageBoard({ doc });
    const id = imageId(board.doc, 0);
    const before = screen.getByTestId(`image-object-${id}`);
    const size = before.getAttribute('style');

    fireEvent.error(before);

    const after = screen.getByTestId(`image-object-${id}`);
    expect(after.getAttribute('data-status')).toBe('ready');
    expect(within(after).getByText('Image unavailable')).toBeTruthy();
    // The same rectangle: a missing picture does not collapse the board.
    expect(after.getAttribute('style')).toBe(size);
    expect(after.tagName).toBe('DIV');
  });

  it('shows the picture itself when it is there', () => {
    const doc = seedDoc({ status: 'ready', uploaderId: OTHER_ID });
    const board = renderImageBoard({ doc });
    const id = imageId(board.doc, 0);

    const img = screen.getByTestId(`image-object-${id}`) as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('alt')).toBe('Image');
    expect(img.getAttribute('src')).toContain('/api/assets/');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
  });
});

describe('TC-24: trying again', () => {
  it('sends the same bytes again from the failed state', async () => {
    const board = renderImageBoard();
    fireDrag(board.viewport, 'drop', [imageFile('shot.png', 'image/png', pngBytes())], {
      x: 0,
      y: 0,
    });
    await flushed();
    const id = imageId(board.doc, 0);
    await uploadSpy.settle(uploadSpy.calls[0] as UploadCall, { kind: 'failed' });

    fireEvent.click(screen.getByTestId(`image-retry-${id}`));
    await flushed();

    expect(uploadSpy.calls).toHaveLength(2);
    expect(imageIn(board.doc, id).status).toBe('uploading');
    // And the retry can succeed like any other upload.
    await uploadSpy.settle(uploadSpy.calls[1] as UploadCall, {
      kind: 'ok',
      assetKey: 'board-1/asset-2',
    });
    expect(imageIn(board.doc, id).status).toBe('ready');
  });

  it('offers only Remove once the bytes are gone with the page', async () => {
    const doc = new Y.Doc();
    const id = seedImage({ doc, status: 'failed', uploaderId: UPLOADER_ID });
    renderImageBoard({ doc });

    const box = screen.getByTestId(`image-object-${id}`);
    expect(within(box).getByText('Upload failed')).toBeTruthy();
    expect(within(box).queryByTestId(`image-retry-${id}`)).toBeNull();
    expect(within(box).getByTestId(`image-remove-${id}`)).toBeTruthy();
  });
});

describe('TC-27 support: an image cannot be resized out of shape', () => {
  it('registers the image as aspect-locked with the agreed floor', async () => {
    const { getObjectType } = await import('../../src/client/objects/registry');
    const spec = getObjectType('image');
    expect(spec?.resizable).toBe(true);
    expect(spec?.aspectLocked).toBe(true);
    expect(spec?.minSize).toBe(IMAGE_MIN_SIZE_WORLD);
    expect(spec?.editableText).toBe(false);
    expect(IMAGE_MIN_SIZE_WORLD).toBeGreaterThan(0);
  });
});

/* --- harness ------------------------------------------------------------- */

/** A board doc holding exactly one seeded image. */
function seedDoc(fixture: Omit<SeedImage, 'doc'>): Y.Doc {
  const doc = new Y.Doc();
  seedImage({ ...fixture, doc });
  return doc;
}

const imageId = (doc: Y.Doc, index: number): string =>
  (objectSnapshots(doc).filter((entry) => entry.type === 'image')[index] as ImageSnap).id;
