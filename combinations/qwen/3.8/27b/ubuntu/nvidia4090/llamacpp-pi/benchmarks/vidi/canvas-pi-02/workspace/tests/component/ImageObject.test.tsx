/**
 * TC-21: the uploading state shows a progress bar with the fraction for the
 *        uploader; other participants see "Uploading…".
 * TC-22: the failed state shows "Upload failed" + Retry + Remove for the
 *        uploader; "Image unavailable" for others.
 * TC-23: the ready state renders an <img> with the asset URL.
 * TC-24: the unfinished state (uploading > 5 min) shows
 *        "Image upload didn't finish" + Remove for anyone.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';

// --- Helpers --------------------------------------------------------------------

function makeImage(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img1',
    type: 'image',
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    z: 0,
    createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 800,
    naturalHeight: 600,
    imageStatus: 'uploading',
    uploadStartedAt: Date.now(),
    uploaderId: 'user1',
    ...overrides,
  };
}

function renderImageObject(props: {
  image: ImageSnap;
  isUploader?: boolean;
  progress?: number;
  canRetry?: boolean;
  now?: number;
  onRetry?: () => void;
  onRemove?: () => void;
}) {
  return render(
    <ImageObject
      image={props.image}
      isUploader={props.isUploader ?? false}
      progress={props.progress}
      canRetry={props.canRetry ?? false}
      now={props.now ?? Date.now()}
      onRetry={props.onRetry ?? vi.fn()}
      onRemove={props.onRemove ?? vi.fn()}
    />,
  );
}

// --- TC-21: uploading state ------------------------------------------------------

describe('TC-21: uploading state', () => {
  it('shows a progress bar with percentage for the uploader', () => {
    const image = makeImage({ imageStatus: 'uploading' });
    renderImageObject({ image, isUploader: true, progress: 0.42 });
    // The progress percentage should be visible.
    expect(screen.getByText('42%')).toBeDefined();
  });

  it('shows "Uploading…" for other participants', () => {
    const image = makeImage({ imageStatus: 'uploading', uploaderId: 'other-user' });
    renderImageObject({ image, isUploader: false });
    expect(screen.getByText('Uploading…')).toBeDefined();
  });
});

// --- TC-22: failed state ---------------------------------------------------------

describe('TC-22: failed state', () => {
  it('shows "Upload failed" + Retry + Remove for the uploader', () => {
    const image = makeImage({ imageStatus: 'failed' });
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    renderImageObject({ image, isUploader: true, canRetry: true, onRetry, onRemove });
    expect(screen.getByText('Upload failed')).toBeDefined();
    expect(screen.getByTestId('image-retry')).toBeDefined();
    expect(screen.getByTestId('image-remove')).toBeDefined();
  });

  it('hides Retry when canRetry is false', () => {
    const image = makeImage({ imageStatus: 'failed' });
    renderImageObject({ image, isUploader: true, canRetry: false });
    expect(screen.getByText('Upload failed')).toBeDefined();
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeDefined();
  });

  it('shows "Image unavailable" for other participants', () => {
    const image = makeImage({ imageStatus: 'failed', uploaderId: 'other-user' });
    renderImageObject({ image, isUploader: false });
    expect(screen.getByText('Image unavailable')).toBeDefined();
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.queryByTestId('image-remove')).toBeNull();
  });
});

// --- TC-23: ready state -----------------------------------------------------------

describe('TC-23: ready state', () => {
  it('renders an <img> with the asset URL', () => {
    const image = makeImage({
      imageStatus: 'ready',
      assetKey: 'board123/asset456',
    });
    renderImageObject({ image, isUploader: true });
    const img = screen.getByTestId('image-object') as HTMLImageElement;
    expect(img.tagName).toBe('IMG');
    expect(img.getAttribute('src')).toBe('/api/assets/board123/asset456');
  });
});

// --- TC-24: unfinished state ------------------------------------------------------

describe('TC-24: unfinished state (uploading > 5 min)', () => {
  it('shows "Image upload didn\'t finish" + Remove', () => {
    const image = makeImage({
      imageStatus: 'uploading',
      uploadStartedAt: 0, // 5+ minutes ago
    });
    const now = 10 * 60 * 1000; // 10 minutes from epoch
    renderImageObject({ image, isUploader: true, now });
    expect(screen.getByText("Image upload didn't finish")).toBeDefined();
    expect(screen.getByTestId('image-remove')).toBeDefined();
  });

  it('shows the unfinished state for non-uploaders too', () => {
    const image = makeImage({
      imageStatus: 'uploading',
      uploadStartedAt: 0,
      uploaderId: 'other-user',
    });
    const now = 10 * 60 * 1000;
    renderImageObject({ image, isUploader: false, now });
    expect(screen.getByText("Image upload didn't finish")).toBeDefined();
    expect(screen.getByTestId('image-remove')).toBeDefined();
  });
});
