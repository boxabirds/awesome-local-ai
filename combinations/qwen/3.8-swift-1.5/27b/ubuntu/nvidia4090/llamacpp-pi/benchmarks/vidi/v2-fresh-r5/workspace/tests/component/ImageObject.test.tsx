/**
 * Component tests for ImageObject render states (story 12).
 * TC-21 to TC-24.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { type ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

function makeImageSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img1',
    type: 'image',
    x: 0,
    y: 0,
    width: 200,
    height: 100,
    z: 1,
    createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 200,
    naturalHeight: 100,
    status: 'uploading',
    uploadStartedAt: 1000,
    uploaderId: 'user1',
    ...overrides,
  };
}

// ─── TC-21: failed object rendered for uploader vs other ─────────────────────

describe('TC-21: failed object rendering', () => {
  it('uploader sees "Upload failed" with Retry and Remove', () => {
    const img = makeImageSnap({ status: 'failed' });
    const onRetry = vi.fn();
    const onRemove = vi.fn();

    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={true}
        now={2000}
        onRetry={onRetry}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByTestId('image-retry-btn')).toBeInTheDocument();
    expect(screen.getByTestId('image-remove-btn')).toBeInTheDocument();
  });

  it('other identity sees "Image unavailable"', () => {
    const img = makeImageSnap({ status: 'failed', uploaderId: 'other-user' });

    render(
      <ImageObject
        image={img}
        isUploader={false}
        canRetry={false}
        now={2000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('image-retry-btn')).not.toBeInTheDocument();
  });
});

// ─── TC-22: uploading older than IMAGE_UPLOAD_STALE_MS → unfinished ─────────

describe('TC-22: unfinished upload', () => {
  it('shows "Image upload didn\'t finish" with Remove; Remove deletes', () => {
    const img = makeImageSnap({
      status: 'uploading',
      uploadStartedAt: 0,
      uploaderId: 'other-user',
    });
    const onRemove = vi.fn();

    // Now is well past the stale threshold
    render(
      <ImageObject
        image={img}
        isUploader={false}
        canRetry={false}
        now={IMAGE_UPLOAD_STALE_MS + 1000}
        onRetry={() => {}}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText("Image upload didn't finish")).toBeInTheDocument();
    const removeBtn = screen.getByTestId('image-remove-btn');
    expect(removeBtn).toBeInTheDocument();

    act(() => {
      removeBtn.click();
    });
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

// ─── TC-23: ready image fires error → "Image unavailable" ────────────────────

describe('TC-23: image load error', () => {
  it('img error event → "Image unavailable" box', () => {
    const img = makeImageSnap({
      status: 'ready',
      assetKey: 'board123/asset456',
    });

    const { container } = render(
      <ImageObject
        image={img}
        isUploader={false}
        canRetry={false}
        now={2000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );

    // Initially shows the img
    const imgEl = container.querySelector('img') as HTMLImageElement;
    expect(imgEl).not.toBeNull();
    expect(imgEl.alt).toBe('Image');

    // Simulate an error event
    act(() => {
      imgEl.dispatchEvent(new Event('error'));
    });

    // Now shows "Image unavailable"
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
  });
});

// ─── TC-24: Retry behaviour ──────────────────────────────────────────────────

describe('TC-24: Retry', () => {
  it('Retry with file in memory: onRetry called', () => {
    const img = makeImageSnap({ status: 'failed' });
    const onRetry = vi.fn();
    const onRemove = vi.fn();

    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={true}
        now={2000}
        onRetry={onRetry}
        onRemove={onRemove}
      />,
    );

    const retryBtn = screen.getByTestId('image-retry-btn');
    act(() => {
      retryBtn.click();
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('Retry hidden when canRetry is false: only Remove shown', () => {
    const img = makeImageSnap({ status: 'failed' });

    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={false}
        now={2000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.queryByTestId('image-retry-btn')).not.toBeInTheDocument();
    expect(screen.getByTestId('image-remove-btn')).toBeInTheDocument();
  });
});

// ─── Uploading state rendering ───────────────────────────────────────────────

describe('ImageObject: uploading state', () => {
  it('uploader sees progress percentage', () => {
    const img = makeImageSnap({ status: 'uploading', uploadStartedAt: 1000 });

    render(
      <ImageObject
        image={img}
        isUploader={true}
        progress={0.5}
        canRetry={false}
        now={2000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('others see "Uploading…"', () => {
    const img = makeImageSnap({ status: 'uploading', uploadStartedAt: 1000, uploaderId: 'other' });

    render(
      <ImageObject
        image={img}
        isUploader={false}
        canRetry={false}
        now={2000}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );

    expect(screen.getByText('Uploading…')).toBeInTheDocument();
  });
});
