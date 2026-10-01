/**
 * Component tests for ImageObject render states (TC-21 to TC-24).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

function makeImageSnap(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 100,
    y: 200,
    width: 300,
    height: 200,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 300,
    naturalHeight: 200,
    status: 'uploading',
    uploadStartedAt: Date.now(),
    uploaderId: 'local',
    z: 1,
    createdAt: Date.now(),
    createdBy: 'local',
    ...overrides,
  };
}

describe('ImageObject failed state (TC-21)', () => {
  it('failed + uploader → "Upload failed" with Retry and Remove', () => {
    const image = makeImageSnap({ status: 'failed' });
    const { getByText } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(getByText('Upload failed')).toBeInTheDocument();
    expect(getByText('Retry')).toBeInTheDocument();
    expect(getByText('Remove')).toBeInTheDocument();
  });

  it('failed + other identity → "Image unavailable"', () => {
    const image = makeImageSnap({ status: 'failed', uploaderId: 'other' });
    const { getByText, queryByText } = render(
      <ImageObject
        image={image}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(getByText('Image unavailable')).toBeInTheDocument();
    expect(queryByText('Retry')).not.toBeInTheDocument();
  });
});

describe('ImageObject unfinished state (TC-22)', () => {
  it('uploading older than IMAGE_UPLOAD_STALE_MS → "Image upload didn\'t finish" + Remove', () => {
    const now = Date.now();
    const image = makeImageSnap({
      status: 'uploading',
      uploadStartedAt: now - IMAGE_UPLOAD_STALE_MS - 1000,
    });
    const onRemove = vi.fn();
    const { getByText } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={now}
        onRetry={vi.fn()}
        onRemove={onRemove}
      />,
    );
    expect(getByText(/Image upload didn/)).toBeInTheDocument();
    const removeBtn = getByText('Remove');
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('ImageObject unavailable state (TC-23)', () => {
  it('ready image with error event → "Image unavailable" box', () => {
    const image = makeImageSnap({
      status: 'ready',
      assetKey: 'board/asset',
    });
    const { getByText, container } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    // Find the img element and fire error
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    fireEvent.error(img!);
    expect(getByText('Image unavailable')).toBeInTheDocument();
  });
});

describe('ImageObject retry (TC-24)', () => {
  it('Retry with file in memory → calls onRetry', () => {
    const image = makeImageSnap({ status: 'failed' });
    const onRetry = vi.fn();
    const { getByText } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={onRetry}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(getByText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('Retry hidden when canRetry=false (simulated reload) → only Remove shown', () => {
    const image = makeImageSnap({ status: 'failed' });
    const { queryByText, getByText } = render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(queryByText('Retry')).not.toBeInTheDocument();
    expect(getByText('Remove')).toBeInTheDocument();
  });
});
