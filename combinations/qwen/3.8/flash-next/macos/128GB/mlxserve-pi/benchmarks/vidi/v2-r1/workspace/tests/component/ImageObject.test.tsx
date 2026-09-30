// One image, shown as the state it is really in (`image.object`, TC-21 to TC-24).
//
// `ImageObject` is presentational: it reads a snapshot and a clock and a couple of
// per-tab answers and renders a box. So these tests hand it exactly those things — a
// snapshot at a chosen `status` and `uploadStartedAt`, `isUploader` true or false, a
// `canRetry` that stands in for "is the file still in this tab's memory" — and assert
// what appears and which buttons a click hands a callback to. Nothing here touches the
// network or the document; that is the hook's suite beside this one.
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

const BASE = {
  id: 'img-1',
  type: 'image' as const,
  x: 10,
  y: 20,
  z: 3,
  width: 400,
  height: 300,
  createdAt: 0,
  naturalWidth: 400,
  naturalHeight: 300,
  contentType: 'image/png',
  uploaderId: 'me',
};

/** A snapshot at a chosen status; `uploadStartedAt` defaults to "just now". */
function snap(overrides: Partial<ImageSnap>): ImageSnap {
  return {
    ...BASE,
    assetKey: null,
    status: 'uploading',
    uploadStartedAt: 1000,
    ...overrides,
  } as ImageSnap;
}

const noop = (): void => {};

describe('image.object (TC-21 to TC-24)', () => {
  it('TC-21 shows a failure the uploader can act on and only "unavailable" to others', () => {
    const failed = snap({ status: 'failed', assetKey: null });

    const uploader = render(
      createElement(ImageObject, {
        image: failed,
        isUploader: true,
        canRetry: true,
        now: 2000,
        onRetry: noop,
        onRemove: noop,
      }),
    );
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    uploader.unmount();

    // The very same failed object is nobody else's to act on: no Retry, no "failed".
    render(
      createElement(ImageObject, {
        image: failed,
        isUploader: false,
        canRetry: true,
        now: 2000,
        onRetry: noop,
        onRemove: noop,
      }),
    );
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it("TC-22 shows \"didn't finish\" and a working Remove once an upload has gone stale", () => {
    const onRemove = vi.fn();
    const stale = snap({ status: 'uploading', uploadStartedAt: 1000 });
    render(
      createElement(ImageObject, {
        image: stale,
        isUploader: false,
        canRetry: false,
        // One millisecond past the stale window: it is no longer a thing in motion.
        now: 1000 + IMAGE_UPLOAD_STALE_MS + 1,
        onRetry: noop,
        onRemove,
      }),
    );
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    // Even for the uploader, a stale upload is "didn't finish", not a percentage.
  });

  it('TC-23 turns a stored image whose bytes will not load into an unavailable box', () => {
    const ready = snap({ status: 'ready', assetKey: 'board/asset' });
    const { getByTestId } = render(
      createElement(ImageObject, {
        image: ready,
        isUploader: true,
        canRetry: false,
        now: 5000,
        onRetry: noop,
        onRemove: noop,
      }),
    );
    // The image is there first, then its load fails.
    const img = getByTestId('image-object-img');
    fireEvent.error(img);
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    // The box keeps the object's size, so an unavailable image leaves a gap its size.
    const box = getByTestId('image-object');
    expect(box.style.width).toBe('400px');
    expect(box.style.height).toBe('300px');
  });

  it('TC-24 offers Retry while the file is held and only Remove after it is gone', () => {
    const onRetry = vi.fn();
    const failed = snap({ status: 'failed' });

    // The uploader, file still in memory: Retry is offered and used.
    const first = render(
      createElement(ImageObject, {
        image: failed,
        isUploader: true,
        canRetry: true,
        now: 2000,
        onRetry,
        onRemove: noop,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    first.unmount();

    // After a reload the file is gone, so Retry is not offered — only Remove remains.
    render(
      createElement(ImageObject, {
        image: failed,
        isUploader: true,
        canRetry: false,
        now: 2000,
        onRetry,
        onRemove: noop,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('shows the uploader a percentage and everyone else a plain "Uploading…"', () => {
    const uploading = snap({ status: 'uploading' });
    render(
      createElement(ImageObject, {
        image: uploading,
        isUploader: true,
        progress: 0.42,
        canRetry: false,
        now: 1000,
        onRetry: noop,
        onRemove: noop,
      }),
    );
    expect(screen.getByText('Uploading 42%')).toBeTruthy();
  });
});
