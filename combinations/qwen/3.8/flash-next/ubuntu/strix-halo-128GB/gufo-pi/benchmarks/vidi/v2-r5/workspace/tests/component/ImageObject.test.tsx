/**
 * Component tests for ImageObject render states (TC-21 to TC-24).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

function makeImageSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    z: 1,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 200,
    naturalHeight: 150,
    status: 'uploading',
    uploadStartedAt: 1000,
    uploaderId: 'user1',
    ...overrides,
  };
}

interface RenderOpts {
  image?: Partial<ImageSnap>;
  isUploader?: boolean;
  progress?: number;
  canRetry?: boolean;
  now?: number;
  selected?: boolean;
}

function renderImage(opts: RenderOpts = {}) {
  const image = makeImageSnap(opts.image);
  const onRetry = vi.fn();
  const onRemove = vi.fn();
  const onSelect = vi.fn();
  render(
    <ImageObject
      image={image}
      isUploader={opts.isUploader ?? true}
      progress={opts.progress}
      canRetry={opts.canRetry ?? true}
      now={opts.now ?? 1000}
      onRetry={onRetry}
      onRemove={onRemove}
      selected={opts.selected}
      onSelect={onSelect}
      zoom={1}
      canEdit={true}
    />,
  );
  return { onRetry, onRemove, onSelect, image };
}

describe('TC-21: failed object rendered for uploader and other', () => {
  it('uploader sees "Upload failed" with Retry and Remove', () => {
    renderImage({
      image: { status: 'failed' },
      isUploader: true,
      canRetry: true,
    });

    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByTestId('retry-button')).toBeInTheDocument();
    expect(screen.getByTestId('remove-button')).toBeInTheDocument();
  });

  it('other participant sees "Image unavailable" for failed', () => {
    renderImage({
      image: { status: 'failed' },
      isUploader: false,
    });

    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('retry-button')).not.toBeInTheDocument();
    expect(screen.queryByTestId('remove-button')).not.toBeInTheDocument();
  });
});

describe('TC-22: uploading stale → "Image upload didn\'t finish" + Remove', () => {
  it('shows unfinished when uploadStartedAt is older than IMAGE_UPLOAD_STALE_MS', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS + 1;
    renderImage({
      image: { status: 'uploading', uploadStartedAt: 1000 },
      isUploader: true,
      now,
    });

    expect(screen.getByText("Image upload didn't finish")).toBeInTheDocument();
    expect(screen.getByTestId('remove-button')).toBeInTheDocument();
  });

  it('Remove button calls onRemove', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS + 1;
    const { onRemove } = renderImage({
      image: { status: 'uploading', uploadStartedAt: 1000 },
      isUploader: true,
      now,
    });

    fireEvent.click(screen.getByTestId('remove-button'));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('TC-23: ready image fires error → "Image unavailable" box', () => {
  it('shows "Image unavailable" when img errors', () => {
    renderImage({
      image: { status: 'ready', assetKey: 'board/asset1' },
    });

    // Verify img is present initially
    const img = document.querySelector('img')!;
    expect(img).toBeInTheDocument();

    // Fire error event via React's event system
    act(() => {
      img.dispatchEvent(new Event('error', { bubbles: false }));
    });

    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
  });

  it('"Image unavailable" box has same size as image', () => {
    renderImage({
      image: { status: 'ready', assetKey: 'board/asset1', width: 300, height: 200 },
    });

    const img = document.querySelector('img')!;
    act(() => {
      img.dispatchEvent(new Event('error', { bubbles: false }));
    });

    const container = screen.getByTestId('image-object');
    expect(container).toBeInTheDocument();
    expect(container.style.width).toBe('300px');
    expect(container.style.height).toBe('200px');
  });
});

describe('TC-24: retry with file in memory vs without', () => {
  it('Retry visible when canRetry is true; calls onRetry', () => {
    const { onRetry } = renderImage({
      image: { status: 'failed' },
      isUploader: true,
      canRetry: true,
    });

    const retryBtn = screen.getByTestId('retry-button');
    expect(retryBtn).toBeInTheDocument();
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalled();
  });

  it('Retry hidden when canRetry is false; only Remove shown', () => {
    renderImage({
      image: { status: 'failed' },
      isUploader: true,
      canRetry: false,
    });

    expect(screen.queryByTestId('retry-button')).not.toBeInTheDocument();
    expect(screen.getByTestId('remove-button')).toBeInTheDocument();
  });
});

describe('uploading state: uploader sees progress, other sees "Uploading…"', () => {
  it('uploader sees progress percentage', () => {
    renderImage({
      image: { status: 'uploading' },
      isUploader: true,
      progress: 0.75,
    });

    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('other participant sees "Uploading…"', () => {
    renderImage({
      image: { status: 'uploading' },
      isUploader: false,
    });

    expect(screen.getByText('Uploading…')).toBeInTheDocument();
  });
});
