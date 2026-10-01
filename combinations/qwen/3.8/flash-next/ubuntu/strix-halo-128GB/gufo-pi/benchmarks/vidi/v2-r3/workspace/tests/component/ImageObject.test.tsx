/**
 * Component tests for ImageObject render states.
 * TC-21, TC-22, TC-23, TC-24
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

function makeImageSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'test-id',
    type: 'image',
    x: 10,
    y: 20,
    width: 200,
    height: 150,
    z: 1,
    createdAt: 1000,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 200,
    naturalHeight: 150,
    status: 'uploading',
    uploadStartedAt: Date.now(),
    uploaderId: 'uploader1',
    ...overrides,
  };
}

describe('ImageObject: failed state (TC-21)', () => {
  it('uploader sees Upload failed with Retry and Remove', () => {
    const image = makeImageSnap({ status: 'failed' });
    render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByTestId('image-retry')).toBeInTheDocument();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
  });

  it('non-uploader sees Image unavailable', () => {
    const image = makeImageSnap({ status: 'failed' });
    render(
      <ImageObject
        image={image}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('image-unavailable')).toBeInTheDocument();
  });
});

describe('ImageObject: unfinished state (TC-22)', () => {
  it('shows Image upload did not finish with Remove for stale upload', () => {
    const staleTime = Date.now() - IMAGE_UPLOAD_STALE_MS - 1000;
    const image = makeImageSnap({ status: 'uploading', uploadStartedAt: staleTime });
    const onRemove = vi.fn();
    render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText("Image upload didn't finish")).toBeInTheDocument();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('image-remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});

describe('ImageObject: image load error (TC-23)', () => {
  it('shows Image unavailable box after img error event', () => {
    const image = makeImageSnap({ status: 'ready', assetKey: 'board1/asset1' });
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
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    fireEvent.error(img!);
    expect(screen.getByTestId('image-unavailable')).toBeInTheDocument();
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
  });
});

describe('ImageObject: retry behavior (TC-24)', () => {
  it('shows Retry button when canRetry is true and calls onRetry', () => {
    const image = makeImageSnap({ status: 'failed' });
    const onRetry = vi.fn();
    render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={onRetry}
        onRemove={vi.fn()}
      />,
    );
    const retryBtn = screen.getByTestId('image-retry');
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('hides Retry when canRetry is false (file lost after reload)', () => {
    const image = makeImageSnap({ status: 'failed' });
    render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('image-retry')).not.toBeInTheDocument();
    expect(screen.getByTestId('image-remove')).toBeInTheDocument();
  });
});
