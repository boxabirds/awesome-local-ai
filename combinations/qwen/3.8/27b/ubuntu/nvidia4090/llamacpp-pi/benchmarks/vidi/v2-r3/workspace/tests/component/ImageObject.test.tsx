/**
 * Story 12 component tests (TC-21 to TC-24): the image object's display
 * states, rendered with the pure ImageObject renderer (the registry wrapper
 * only adds positioning + the generic gesture).
 *
 *   TC-21  failed: uploader → "Upload failed" + Retry + Remove; other →
 *         "Image unavailable" (no controls)
 *   TC-22  stale uploading (> IMAGE_UPLOAD_STALE_MS) → "Image upload didn't
 *         finish" + Remove; Remove deletes
 *   TC-23  ready image whose <img> errors → "Image unavailable" box, same size
 *   TC-24  Retry with file in memory re-uploads; after a reload (file gone)
 *         only Remove is offered
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import type { ImageSnap } from '../../src/shared/objects/image';

const T0 = 1_000_000;

function snap(partial: Partial<ImageSnap> = {}): ImageSnap {
  return {
    type: 'image',
    id: partial.id ?? 'img-1',
    x: 0,
    y: 0,
    width: 120,
    height: 80,
    z: 1,
    createdAt: T0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 120,
    naturalHeight: 80,
    status: 'uploading',
    uploadStartedAt: T0,
    uploaderId: 'me',
    ...partial,
  } as ImageSnap;
}

function renderImage(image: ImageSnap, opts: { isUploader?: boolean; progress?: number; canRetry?: boolean; now?: number } = {}) {
  const onRetry = vi.fn();
  const onRemove = vi.fn();
  const view = render(
    <ImageObject
      image={image}
      isUploader={opts.isUploader ?? true}
      progress={opts.progress}
      canRetry={opts.canRetry ?? false}
      now={opts.now ?? T0 + 1000}
      onRetry={onRetry}
      onRemove={onRemove}
    />,
  );
  return { ...view, onRetry, onRemove };
}

afterEach(() => cleanup());

describe('image.object (TC-21 to TC-24)', () => {
  it('TC-21: failed shows Retry + Remove to the uploader, "Image unavailable" to others', () => {
    const mine = renderImage(snap({ status: 'failed' }), { isUploader: true, canRetry: true });
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    cleanup();

    const theirs = renderImage(snap({ status: 'failed' }), { isUploader: false });
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(theirs.container.querySelector('[data-image-ready]')).toBeNull();
  });

  it('TC-22: a stale upload shows "Image upload didn’t finish" with Remove; Remove deletes', () => {
    const v = renderImage(
      snap({ status: 'uploading', uploadStartedAt: T0 }),
      { isUploader: false, now: T0 + IMAGE_UPLOAD_STALE_MS + 1 },
    );
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    const remove = screen.getByRole('button', { name: 'Remove' });
    fireEvent.click(remove);
    expect(v.onRemove).toHaveBeenCalledTimes(1);
    // Just before the stale threshold it is still "Uploading…".
    cleanup();
    renderImage(snap({ status: 'uploading', uploadStartedAt: T0 }), {
      isUploader: false,
      now: T0 + IMAGE_UPLOAD_STALE_MS - 1,
    });
    expect(screen.getByText('Uploading…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('TC-23: an <img> load error swaps in an "Image unavailable" box at the same size', () => {
    const key = 'bbbbbbbbbbbbbbbbbbbbbb/cccccccccccccccccccccc';
    const v = renderImage(snap({ status: 'ready', assetKey: key }), { isUploader: false });
    const img = v.container.querySelector('img[data-image-ready]') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(`/api/assets/${key}`);
    // Same size as the object: the img fills the 100%×100% box.
    expect(img.style.width).toBe('100%');
    expect(img.style.height).toBe('100%');
    fireEvent.error(img);
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(v.container.querySelector('img[data-image-ready]')).toBeNull();
  });

  it('TC-24: Retry re-uploads while the file is in memory; after a reload only Remove is offered', () => {
    // File still in memory (canRetry): Retry is offered and wired.
    const withFile = renderImage(snap({ status: 'failed' }), { isUploader: true, canRetry: true });
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(withFile.onRetry).toHaveBeenCalledTimes(1);
    cleanup();
    // Simulated reload: the in-memory file is gone → Retry hidden, Remove only.
    const afterReload = renderImage(snap({ status: 'failed' }), { isUploader: true, canRetry: false });
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('uploading: the uploader sees a progress percentage, others see "Uploading…"', () => {
    const v = renderImage(snap({ status: 'uploading' }), { isUploader: true, progress: 0.5 });
    expect(screen.getByText('Uploading 50%')).toBeTruthy();
    expect(v.container.querySelector('[data-progress-fill]')?.getAttribute('style')).toContain('width: 50%');
    cleanup();
    renderImage(snap({ status: 'uploading' }), { isUploader: false });
    expect(screen.getByText('Uploading…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('ready: renders the immutable asset URL with the a11y label "Image"', () => {
    const v = renderImage(snap({ status: 'ready', assetKey: 'dddddddddddddddddddddd/eeeeeeeeeeeeeeeeeeeeee' }), {
      isUploader: false,
    });
    const img = v.container.querySelector('img[data-image-ready]') as HTMLImageElement;
    expect(img.getAttribute('alt')).toBe('Image');
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.getAttribute('loading')).toBe('lazy');
  });
});
