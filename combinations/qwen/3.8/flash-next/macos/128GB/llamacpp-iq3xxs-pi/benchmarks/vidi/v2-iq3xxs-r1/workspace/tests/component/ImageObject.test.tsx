import { beforeAll, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Board } from '../../src/client/board/Board';
import { ImageObject, IMAGE_STATUS_TEXT } from '../../src/client/objects/ImageObject';
import { clearToasts } from '../../src/client/ui/Toast';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { markImageFailed } from '../../src/shared/objects/image';
import { TEST_BOARD_ID, flushFrame, flushUntil } from './util';
import { getDoc } from './stickyUtil';
import { fakeAssetKey, uploadFake, uploadFor } from './imageUploadFake';
import {
  createOneImagePlaceholder,
  installImageBitmapStub,
  dropFiles,
  fixtures,
  imageEls,
  imageSnaps,
  imageStatus,
  oneImage,
} from './imageUtil';

/* TC-24 needs a real Retry, which needs a real upload to fail — and that upload is
   recorded here rather than sent, so a failure is a line in the test rather than a
   server being ill on command. */
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
 * Story 12 — the states of one image (image.object, image.upload_failure,
 * image.unfinished, image.unavailable).
 *
 * An image object is one box with five things it can be, and which of them you see
 * depends on who you are: the person holding the file gets Retry, everybody else reads
 * the same object as a gap in the board. Most of these render the object on its own,
 * because the state is a fact about one object; the two that are about clearing a board
 * go through a Board, where Remove is the real delete.
 */

beforeAll(() => {
  // TC-24 adds an image by dropping a file, and that measures it (jsdom has no decoder).
  installImageBitmapStub();
});

beforeEach(() => {
  uploadFake.reset();
  clearToasts();
});

// TC-21: the person who has the file is offered Retry and Remove; everyone else reads the
// same object as "Image unavailable" and is offered Remove only.
it('TC-21: a failed upload is Retry and Remove for the uploader, Image unavailable for anybody else', () => {
  const { snap } = oneImage((doc, id) => markImageFailed(doc, id!));

  const retry = vi.fn();
  const asUploader = render(
    <ImageObject
      image={snap}
      selected={false}
      isUploader
      canRetry
      now={Date.now()}
      onRetry={retry}
      onRemove={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByTestId('image-status').textContent).toBe(IMAGE_STATUS_TEXT.failed);
  fireEvent.click(screen.getByTestId('image-retry'));
  expect(retry).toHaveBeenCalled();
  expect(screen.getByTestId('image-remove')).toBeTruthy();
  asUploader.unmount();

  render(
    <ImageObject
      image={snap}
      selected={false}
      isUploader={false}
      canRetry={false}
      now={Date.now()}
      onRetry={vi.fn()}
      onRemove={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByTestId('image-status').textContent).toBe(IMAGE_STATUS_TEXT.unavailable);
  expect(screen.queryByTestId('image-retry')).toBeNull(); // not this tab's bytes to send
  expect(screen.getByTestId('image-remove')).toBeTruthy();
});

// TC-22: an upload that never finished — because the tab that ran it went away — is named
// for what it is, and anyone who can edit can clear it away.
it('TC-22: an upload older than the stale window says so, and Remove deletes the object', async () => {
  render(<Board boardId={TEST_BOARD_ID} sync={false} />);
  // Someone else's tab, started longer ago than the stale window allows.
  createOneImagePlaceholder(getDoc(), 'someone-else', Date.now() - IMAGE_UPLOAD_STALE_MS - 1);
  await flushFrame();
  await flushUntil(() => imageSnaps().length === 1);

  expect(imageStatus()).toBe(IMAGE_STATUS_TEXT.unfinished);
  expect(screen.queryByTestId('image-retry')).toBeNull(); // not this tab's file to retry
  expect(screen.getByTestId('image-object').getAttribute('data-status')).toBe('unfinished');

  fireEvent.click(screen.getByTestId('image-remove'));
  await flushUntil(() => imageSnaps().length === 0);
  expect(imageEls()).toHaveLength(0);
});

// TC-23: a stored picture that would not load keeps its box — same size, different words
// — instead of a broken-image icon.
it('TC-23: a ready picture that fails to load becomes an unavailable box of the same size', () => {
  const { snap } = oneImage();
  const ready = { ...snap, status: 'ready' as const, assetKey: fakeAssetKey(TEST_BOARD_ID, 'photo-1') };
  render(
    <ImageObject
      image={ready}
      selected={false}
      isUploader
      canRetry={false}
      now={Date.now()}
      onRetry={vi.fn()}
      onRemove={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  const box = screen.getByTestId('image-object');
  const sizeBefore = [box.style.width, box.style.height];
  expect(screen.getByTestId('image-picture')).toBeTruthy();

  fireEvent.error(screen.getByTestId('image-picture'));
  expect(screen.queryByTestId('image-picture')).toBeNull();
  expect(screen.getByTestId('image-status').textContent).toBe(IMAGE_STATUS_TEXT.unavailable);
  expect([box.style.width, box.style.height]).toEqual(sizeBefore);
  // A picture that cannot be fetched is nobody's upload to retry, but it is still
  // something the board can be cleared of.
  expect(screen.queryByTestId('image-retry')).toBeNull();
  expect(screen.getByTestId('image-remove')).toBeTruthy();
});

// TC-24: Retry sends the same bytes again and puts the object back to uploading; after a
// reload there are no bytes here, so only Remove is offered.
it('TC-24: Retry uploads the same file again; after a reload only Remove is offered', async () => {
  render(<Board boardId={TEST_BOARD_ID} sync={false} />);
  const files = await fixtures('photo.png');
  dropFiles(files);
  await flushFrame();
  await flushUntil(() => imageSnaps().length === 1);

  await act(async () => {
    uploadFor(0).fail(500);
  });
  await flushUntil(() => imageSnaps()[0]?.status === 'failed');
  expect(imageStatus()).toBe(IMAGE_STATUS_TEXT.failed);

  fireEvent.click(screen.getByTestId('image-retry'));
  await flushUntil(() => uploadFake.started.length === 2);
  expect(uploadFake.started[1]!.file).toBe(files[0]); // the same bytes, not read again
  expect(imageSnaps()[0]?.status).toBe('uploading');
  expect(screen.getByTestId('image-status').textContent).toBe('Uploading… 0%');

  await act(async () => {
    uploadFor(1).succeed();
  });
  await flushUntil(() => imageSnaps()[0]?.status === 'ready');
  expect(screen.getAllByTestId('image-picture')).toHaveLength(1);

  // A reload leaves the object failed and this tab holding nothing: the design's
  // "Retry after simulated reload" case is `canRetry: false`, which hides Retry.
  const { snap } = oneImage((doc, id) => markImageFailed(doc, id!));
  render(
    <ImageObject
      image={snap}
      selected={false}
      isUploader
      canRetry={false}
      now={Date.now()}
      onRetry={vi.fn()}
      onRemove={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.queryByTestId('image-retry')).toBeNull();
  expect(screen.getAllByTestId('image-remove')).toHaveLength(1);
});

it('a viewer who cannot edit is not offered Remove either', () => {
  const { snap } = oneImage((doc, id) => markImageFailed(doc, id!));
  render(
    <ImageObject
      image={snap}
      selected={false}
      isUploader={false}
      canRetry={false}
      now={Date.now()}
      onRetry={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.getByTestId('image-status').textContent).toBe(IMAGE_STATUS_TEXT.unavailable);
  expect(screen.queryByTestId('image-remove')).toBeNull();
});

// The buttons live inside the object's box, and the box is what a move gesture starts
// from. A press on Retry or Remove stays a press on a button — otherwise the image would
// slide away under a finger that meant the button (and TC-24's Retry would be a drag).
it('keeps a press on the controls from grabbing the image', () => {
  const { snap } = oneImage((doc, id) => markImageFailed(doc, id!));
  const grabbed = vi.fn();
  render(
    <ImageObject
      image={snap}
      selected={false}
      isUploader
      canRetry
      now={Date.now()}
      onRetry={vi.fn()}
      onRemove={vi.fn()}
      onObjectPointerDown={grabbed}
      onSelect={vi.fn()}
    />,
  );

  fireEvent.pointerDown(screen.getByTestId('image-retry'));
  fireEvent.pointerDown(screen.getByTestId('image-remove'));
  expect(grabbed).not.toHaveBeenCalled();

  // The box itself still answers, or the image could never be moved.
  fireEvent.pointerDown(screen.getByTestId('image-object'));
  expect(grabbed).toHaveBeenCalledTimes(1);
});

// The key sits in a document that everyone holding the link can write. A `ready` object
// whose key is not an asset key is not a picture waiting to be fetched: it is a gap, it
// gets the box and the words of a gap, and no request is made to whatever that text names.
it('will not build a picture URL out of a key that is not an asset key', () => {
  const { snap } = oneImage();
  const hostile = { ...snap, status: 'ready' as const, assetKey: `../../etc/passwd` };
  render(
    <ImageObject
      image={hostile}
      selected={false}
      isUploader
      canRetry={false}
      now={Date.now()}
      onRetry={vi.fn()}
      onRemove={vi.fn()}
      onSelect={vi.fn()}
    />,
  );
  expect(screen.queryByTestId('image-picture')).toBeNull();
  expect(screen.getByTestId('image-status').textContent).toBe(IMAGE_STATUS_TEXT.unavailable);
  expect(screen.getByTestId('image-object').getAttribute('data-status')).toBe('unavailable');
});
