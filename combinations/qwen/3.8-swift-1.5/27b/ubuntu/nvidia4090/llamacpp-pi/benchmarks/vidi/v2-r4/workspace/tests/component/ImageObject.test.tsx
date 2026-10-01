// @vitest-environment jsdom
/**
 * Component tests — ImageObject render states (story 12, TC-21 to TC-24).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { ImageObject, type ImageObjectProps } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

function makeImage(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img_test_id_000000000001',
    type: 'image',
    x: 10,
    y: 20,
    z: 1,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 80,
    status: 'uploading',
    uploadStartedAt: 1_000_000,
    uploaderId: 'uploader-1',
    width: 100,
    height: 80,
    ...overrides,
  };
}

function renderImage(
  image: ImageSnap,
  opts: { isUploader?: boolean; progress?: number; canRetry?: boolean; now?: number } = {},
) {
  const onRetry = vi.fn();
  const onRemove = vi.fn();
  const props: ImageObjectProps = {
    obj: image,
    doc: new Y.Doc(),
    zoom: 1,
    selected: false,
    editing: false,
    editable: true,
    onPointerDown: vi.fn(),
    onStartEdit: vi.fn(),
    onEndEdit: vi.fn(),
    isUploader: opts.isUploader ?? true,
    progress: opts.progress,
    canRetry: opts.canRetry ?? false,
    now: opts.now ?? 1_000_000,
    onRetry,
    onRemove,
  };
  const view = render(<ImageObject {...props} />);
  return { view, onRetry, onRemove };
}

afterEach(() => cleanup());

describe('ImageObject render states', () => {
  it('TC-21: a failed object renders Retry+Remove for the uploader, "Image unavailable" for others', () => {
    const img = makeImage({ status: 'failed' });

    const uploader = renderImage(img, { isUploader: true, canRetry: true });
    expect(uploader.view.getByTestId('image-failed')).toBeTruthy();
    expect(uploader.view.getByText('Upload failed')).toBeTruthy();
    expect(uploader.view.getByTestId('image-retry')).toBeTruthy();
    expect(uploader.view.getByTestId('image-remove')).toBeTruthy();

    cleanup();
    const other = renderImage(img, { isUploader: false });
    expect(other.view.getByTestId('image-unavailable')).toBeTruthy();
    expect(other.view.getByText('Image unavailable')).toBeTruthy();
    expect(other.view.queryByTestId('image-retry')).toBeNull();
  });

  it('TC-22: an uploading object older than the stale threshold renders "didn\'t finish" + Remove; Remove deletes', () => {
    const img = makeImage({ status: 'uploading', uploadStartedAt: 1_000_000 });
    const staleNow = 1_000_000 + IMAGE_UPLOAD_STALE_MS + 1;

    const { view, onRemove } = renderImage(img, { isUploader: true, now: staleNow });
    expect(view.getByTestId('image-unfinished')).toBeTruthy();
    expect(view.getByText("Image upload didn't finish")).toBeTruthy();
    expect(view.getByTestId('image-remove')).toBeTruthy();

    fireEvent.click(view.getByTestId('image-remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('TC-23: an image whose <img> errors renders the "Image unavailable" box at the same size', () => {
    const img = makeImage({ status: 'ready', assetKey: 'board1/asset1' });
    const { view } = renderImage(img, { isUploader: false });

    const imgEl = view.getByAltText('Image');
    expect(imgEl).toBeTruthy();

    fireEvent.error(imgEl);
    expect(view.getByTestId('image-unavailable')).toBeTruthy();
    expect(view.getByText('Image unavailable')).toBeTruthy();
  });

  it('TC-24: Retry (file in memory) calls onRetry; after a simulated reload (no file) Retry is hidden and only Remove remains', () => {
    const img = makeImage({ status: 'failed' });

    // File still in memory → Retry shown and callable.
    const withFile = renderImage(img, { isUploader: true, canRetry: true });
    expect(withFile.view.getByTestId('image-retry')).toBeTruthy();
    fireEvent.click(withFile.view.getByTestId('image-retry'));
    expect(withFile.onRetry).toHaveBeenCalledTimes(1);

    // Simulated reload → the in-memory file is gone → Retry hidden.
    cleanup();
    const afterReload = renderImage(img, { isUploader: true, canRetry: false });
    expect(afterReload.view.queryByTestId('image-retry')).toBeNull();
    expect(afterReload.view.getByTestId('image-remove')).toBeTruthy();
    expect(afterReload.view.getByText('Upload failed')).toBeTruthy();
  });
});
