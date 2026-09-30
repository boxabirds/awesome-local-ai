import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

function makeImage(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 0, y: 0, z: 0,
    width: 200, height: 100,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 200, naturalHeight: 100,
    status: 'uploading',
    uploadStartedAt: 0,
    uploaderId: 'user-1',
    ...overrides,
  };
}

describe('TC-21: failed object rendering', () => {
  it('uploader sees "Upload failed" with Retry and Remove', () => {
    const img = makeImage({ status: 'failed' });
    const onRetry = vi.fn();
    const onRemove = vi.fn();

    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={onRetry}
        onRemove={onRemove}
      />
    );

    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('other identity sees "Image unavailable"', () => {
    const img = makeImage({ status: 'failed', uploaderId: 'other-user' });
    const onRetry = vi.fn();
    const onRemove = vi.fn();

    render(
      <ImageObject
        image={img}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={onRetry}
        onRemove={onRemove}
      />
    );

    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});

describe('TC-22: unfinished upload', () => {
  it('shows "Image upload didn\'t finish" + Remove; Remove deletes', () => {
    const img = makeImage({
      status: 'uploading',
      uploadStartedAt: 0,
    });
    const onRemove = vi.fn();

    // Now is past the stale threshold
    const now = IMAGE_UPLOAD_STALE_MS + 1000;

    render(
      <ImageObject
        image={img}
        isUploader={false}
        canRetry={false}
        now={now}
        onRetry={vi.fn()}
        onRemove={onRemove}
      />
    );

    expect(screen.getByText("Image upload didn't finish")).toBeInTheDocument();
    const removeBtn = screen.getByRole('button', { name: 'Remove' });
    expect(removeBtn).toBeInTheDocument();

    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('TC-23: image load error', () => {
  it('ready image fires error → "Image unavailable" box', () => {
    const img = makeImage({ status: 'ready', assetKey: 'board/asset123' });

    const { container } = render(
      <ImageObject
        image={img}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    const imgEl = container.querySelector('img')!;
    expect(imgEl).toBeInTheDocument();

    // Simulate load error
    fireEvent.error(imgEl);

    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
  });
});

describe('TC-24: retry behaviour', () => {
  it('retry with file in memory calls onRetry', () => {
    const img = makeImage({ status: 'failed' });
    const onRetry = vi.fn();

    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={true}
        now={Date.now()}
        onRetry={onRetry}
        onRemove={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('after simulated reload (canRetry=false) → Retry hidden, only Remove', () => {
    const img = makeImage({ status: 'failed' });

    render(
      <ImageObject
        image={img}
        isUploader={true}
        canRetry={false}
        now={Date.now()}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });
});
