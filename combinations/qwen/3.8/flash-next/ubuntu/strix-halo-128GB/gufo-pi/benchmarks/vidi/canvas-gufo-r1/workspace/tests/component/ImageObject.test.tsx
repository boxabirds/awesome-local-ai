/**
 * Story 12: ImageObject component tests.
 * TC-21 to TC-24
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

function makeImage(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 100,
    y: 200,
    width: 400,
    height: 300,
    z: 1,
    createdAt: Date.now(),
    createdBy: 'user-1',
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 400,
    naturalHeight: 300,
    status: 'uploading',
    uploadStartedAt: Date.now(),
    uploaderId: 'user-1',
    text: '',
    ...overrides,
  };
}

// ─── TC-21: Failed object — uploader vs other ───────────────────────────────

describe('TC-21: Failed image rendering', () => {
  it('uploader sees "Upload failed" with Retry and Remove', () => {
    const image = makeImage({ status: 'failed' });
    const onRetry = vi.fn();
    const onRemove = vi.fn();

    const { container } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={onRetry}
        onRemove={onRemove}
      />,
    );

    expect(container.textContent).toContain('Upload failed');
    expect(container.querySelector('.image-retry-btn')).not.toBeNull();
    expect(container.querySelector('.image-remove-btn')).not.toBeNull();
  });

  it('other participant sees "Image unavailable"', () => {
    const image = makeImage({ status: 'failed' });
    const onRetry = vi.fn();
    const onRemove = vi.fn();

    const { container } = render(
      <ImageObject
        image={image}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={onRetry}
        onRemove={onRemove}
      />,
    );

    expect(container.textContent).toContain('Image unavailable');
    expect(container.querySelector('.image-retry-btn')).toBeNull();
  });
});

// ─── TC-22: Uploading older than stale threshold → unfinished ───────────────

describe('TC-22: Unfinished image', () => {
  it('shows "Image upload didn\'t finish" + Remove for anyone', () => {
    const staleTime = Date.now() - IMAGE_UPLOAD_STALE_MS - 1000;
    const image = makeImage({ status: 'uploading', uploadStartedAt: staleTime });
    const onRemove = vi.fn();

    const { container } = render(
      <ImageObject
        image={image}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={onRemove}
      />,
    );

    expect(container.textContent).toContain("Image upload didn't finish");
    expect(container.querySelector('.image-remove-btn')).not.toBeNull();
  });

  it('Remove deletes the object', () => {
    const staleTime = Date.now() - IMAGE_UPLOAD_STALE_MS - 1000;
    const image = makeImage({ status: 'uploading', uploadStartedAt: staleTime });
    const onRemove = vi.fn();

    const { container } = render(
      <ImageObject
        image={image}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={onRemove}
      />,
    );

    const btn = container.querySelector('.image-remove-btn') as HTMLElement;
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

// ─── TC-23: Image error → "Image unavailable" ───────────────────────────────

describe('TC-23: Ready image with load error → unavailable', () => {
  it('img error shows "Image unavailable" box', () => {
    const image = makeImage({ status: 'ready', assetKey: 'board-123/asset-456' });

    const { container } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    // Simulate img error
    const img = container.querySelector('img')!;
    fireEvent.error(img);

    expect(container.textContent).toContain('Image unavailable');
  });
});

// ─── TC-24: Retry behavior ──────────────────────────────────────────────────

describe('TC-24: Retry', () => {
  it('canRetry=true shows Retry button; clicking calls onRetry', () => {
    const image = makeImage({ status: 'failed' });
    const onRetry = vi.fn();

    const { container } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={onRetry}
        onRemove={vi.fn()}
      />,
    );

    const btn = container.querySelector('.image-retry-btn') as HTMLElement;
    fireEvent.click(btn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('canRetry=false hides Retry, only Remove shown', () => {
    const image = makeImage({ status: 'failed' });

    const { container } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    expect(container.querySelector('.image-retry-btn')).toBeNull();
    expect(container.querySelector('.image-remove-btn')).not.toBeNull();
  });
});
