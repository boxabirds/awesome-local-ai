/**
 * Component tests for ImageObject render states (TC-21 to TC-24).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

function makeImage(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img1',
    type: 'image',
    x: 0,
    y: 0,
    width: 200,
    height: 150,
    z: 1,
    createdAt: 1000,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 200,
    naturalHeight: 150,
    status: 'uploading',
    uploadStartedAt: 1000,
    uploaderId: 'user1',
    text: '',
    ...overrides,
  };
}

describe('TC-21: failed object rendering', () => {
  it('uploader sees Upload failed with Retry and Remove', () => {
    const image = makeImage({ status: 'failed', assetKey: null });
    render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={true}
        now={2000}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.getByText('Remove')).toBeInTheDocument();
  });

  it('other identity sees Image unavailable', () => {
    const image = makeImage({ status: 'failed', assetKey: null });
    render(
      <ImageObject
        image={image}
        isUploader={false}
        canRetry={false}
        now={2000}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    expect(screen.queryByText('Remove')).not.toBeInTheDocument();
  });
});

describe('TC-22: uploading beyond stale timeout shows unfinished', () => {
  it('displays "Image upload didn\'t finish" + Remove after stale timeout', () => {
    const now = 1000 + IMAGE_UPLOAD_STALE_MS + 1;
    const image = makeImage({ status: 'uploading', uploadStartedAt: 1000 });
    const onRemove = vi.fn();
    render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={now}
        onRetry={vi.fn()}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText("Image upload didn't finish")).toBeInTheDocument();
    fireEvent.click(screen.getByText('Remove'));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('TC-23: ready image fires error → Image unavailable', () => {
  it('shows unavailable box on img error', () => {
    const image = makeImage({ status: 'ready', assetKey: 'board/asset1' });
    const { container } = render(
      <ImageObject
        image={image}
        isUploader={false}
        canRetry={false}
        now={2000}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    // Simulate error
    fireEvent.error(img!);
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    // Box should have same dimensions
    const box = screen.getByText('Image unavailable').closest('[data-image-state]');
    expect(box).toHaveStyle({ width: '200px', height: '150px' });
  });
});

describe('TC-24: Retry behaviour', () => {
  it('Retry with file in memory calls onRetry', () => {
    const image = makeImage({ status: 'failed' });
    const onRetry = vi.fn();
    render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={true}
        now={2000}
        onRetry={onRetry}
        onRemove={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('Retry hidden when canRetry is false (page reload scenario)', () => {
    const image = makeImage({ status: 'failed' });
    render(
      <ImageObject
        image={image}
        isUploader={true}
        canRetry={false}
        now={2000}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    expect(screen.getByText('Remove')).toBeInTheDocument();
  });
});
