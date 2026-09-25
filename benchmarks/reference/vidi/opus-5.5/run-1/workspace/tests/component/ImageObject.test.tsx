/**
 * image.object (story 12): render states per displayStatus and identity (TC-21 to TC-24), the
 * registry entry, and Remove / Retry on the real board.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ImageObject, type ImageObjectProps } from '../../src/client/objects/ImageObject';
import { getObjectType } from '../../src/client/objects/registry';
import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { assetKeyFor } from '../../src/shared/image-format';
import { createImagePlaceholders, markImageReady, type ImageSnap } from '../../src/shared/objects/image';
import {
  dropFiles,
  imageEl,
  imageFile,
  images,
  renderConnectedBoard,
  stubDecoder,
  uploads,
} from './imageHelpers';
import { board } from './stickyHelpers';

vi.mock('../../src/client/images/uploadImage', async () => {
  const { mockUpload } = await import('./uploadMock');
  return { uploadImage: vi.fn(mockUpload) };
});

const NOW = 1_700_000_000_000;
const ME = 'g_leo';
const SOMEONE_ELSE = 'g_sam';

function snap(over: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    z: 1,
    createdAt: NOW,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 400,
    naturalHeight: 300,
    status: 'uploading',
    uploadStartedAt: NOW,
    uploaderId: ME,
    ...over,
  };
}

function renderImage(props: Partial<ImageObjectProps> & { image: ImageSnap }) {
  const onRetry = vi.fn();
  const onRemove = vi.fn();
  const utils = render(
    <ImageObject isUploader canRetry now={NOW} onRetry={onRetry} onRemove={onRemove} {...props} />,
  );
  return { ...utils, onRetry, onRemove };
}

/** Adds an image straight to the board's document (as if another person had). */
function addImage(over: { uploaderId?: string; startedAt?: number } = {}): string {
  const doc = window.__vidi6!.getDoc();
  let id = '';
  act(() => {
    [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 400, height: 300 }, naturalWidth: 800, naturalHeight: 600, contentType: 'image/png' }],
      over.uploaderId ?? SOMEONE_ELSE,
      over.startedAt ?? Date.now(),
    ) as [string];
  });
  return id;
}

beforeEach(() => {
  uploads.length = 0;
  stubDecoder({ 'a.png': { width: 400, height: 300 } });
});

describe('registry', () => {
  it('image: resizable, aspect-locked, IMAGE_MIN_SIZE_WORLD, no text, hit anywhere in its box', () => {
    const spec = getObjectType('image');
    expect(spec).toMatchObject({ resizable: true, aspectLocked: true, minSize: IMAGE_MIN_SIZE_WORLD, editableText: false });
    const img = snap({ x: 10, y: 10 });
    expect(spec!.hitTest(img, { x: 200, y: 150 })).toBe(true);
    expect(spec!.hitTest(img, { x: 411, y: 150 })).toBe(false);
  });
});

describe('TC-21 failed', () => {
  it('uploader: "Upload failed" with Retry and Remove; another person: "Image unavailable" only', () => {
    const failed = snap({ status: 'failed' });
    const mine = renderImage({ image: failed });
    expect(screen.getByText('Upload failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(mine.onRetry).toHaveBeenCalledTimes(1);
    expect(mine.onRemove).toHaveBeenCalledTimes(1);
    mine.unmount();

    renderImage({ image: failed, isUploader: false });
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByText('Upload failed')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('uploading: the uploader sees a percentage, others "Uploading…"', () => {
    const { unmount } = renderImage({ image: snap(), progress: 0.25 });
    expect(screen.getByText('25%')).toBeTruthy();
    unmount();
    renderImage({ image: snap(), isUploader: false });
    expect(screen.getByText('Uploading…')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('TC-22 unfinished', () => {
  it('uploading longer than IMAGE_UPLOAD_STALE_MS → "Image upload didn\'t finish" + Remove, for anyone', () => {
    const stale = snap({ uploadStartedAt: NOW - IMAGE_UPLOAD_STALE_MS - 1 });
    const { unmount } = renderImage({ image: stale, isUploader: false });
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    unmount();
    renderImage({ image: snap({ uploadStartedAt: NOW - IMAGE_UPLOAD_STALE_MS + 1 }), isUploader: false });
    expect(screen.getByText('Uploading…')).toBeTruthy();
  });

  it('on the board: Remove deletes the object', () => {
    renderConnectedBoard();
    const id = addImage({ startedAt: Date.now() - IMAGE_UPLOAD_STALE_MS - 1 });
    expect(imageEl(id).textContent).toContain("Image upload didn't finish");
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(images()).toHaveLength(0);
  });

  it('an upload that goes stale while the board is open turns unfinished by itself', () => {
    renderConnectedBoard(true, ['setInterval', 'clearInterval', 'Date']);
    const id = addImage();
    expect(imageEl(id).textContent).toContain('Uploading…');
    act(() => {
      vi.advanceTimersByTime(IMAGE_UPLOAD_STALE_MS + IMAGE_UPLOAD_STALE_MS / 10);
    });
    expect(imageEl(id).textContent).toContain("Image upload didn't finish");
  });
});

describe('TC-23 unavailable', () => {
  it('an img error shows "Image unavailable" in a box of the same size; the rest of the board still works', () => {
    renderConnectedBoard();
    const id = addImage();
    act(() => {
      markImageReady(window.__vidi6!.getDoc(), id, assetKeyFor(newBoardId(), newBoardId()));
    });
    const el = imageEl(id);
    const img = el.querySelector('img')!;
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('draggable')).toBe('false');
    fireEvent.error(img);
    expect(el.textContent).toContain('Image unavailable');
    expect(el.querySelector('img')).toBeNull();
    expect([el.style.width, el.style.height]).toEqual(['400px', '300px']);
    expect(screen.getByRole('group', { name: 'Image' })).toBe(el);
  });
});

describe('TC-24 retry', () => {
  it('with the file in memory Retry uploads again (status uploading); without it only Remove shows', async () => {
    renderConnectedBoard();
    dropFiles(board(), [imageFile('a.png')], { x: 300, y: 200 });
    await waitFor(() => expect(images()).toHaveLength(1));
    const id = images()[0]!.id;
    await uploads[0]!.resolve({ kind: 'failed', status: 500 });
    expect(images()[0]!.status).toBe('failed');
    expect(imageEl(id).textContent).toContain('Upload failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(images()[0]!.status).toBe('uploading');
    expect(uploads).toHaveLength(2);
    expect(uploads[1]!.file).toBe(uploads[0]!.file);
    await uploads[1]!.resolve({ kind: 'ok', assetKey: assetKeyFor(newBoardId(), newBoardId()) });
    expect(images()[0]!.status).toBe('ready');
  });

  it('after a reload (file not in memory): Retry is hidden, only Remove', () => {
    renderImage({ image: snap({ status: 'failed' }), canRetry: false });
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});
