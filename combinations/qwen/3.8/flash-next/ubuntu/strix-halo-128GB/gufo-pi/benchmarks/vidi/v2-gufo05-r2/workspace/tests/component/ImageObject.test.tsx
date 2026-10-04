/**
 * Story 12 component tests: ImageObject render states (TC-21 to TC-24).
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import type { ImageSnapshot } from '../../src/shared/objects/image';
import { ImageObjectDirect } from '../../src/client/objects/ImageObject';

function makeImage(overrides: Partial<ImageSnapshot> = {}): ImageSnapshot {
  return {
    id: 'img-1',
    type: 'image',
    x: 100,
    y: 200,
    width: 300,
    height: 200,
    z: 1,
    createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 300,
    naturalHeight: 200,
    status: 'uploading',
    uploadStartedAt: 1000,
    uploaderId: 'user-1',
    ...overrides,
  };
}

describe('TC-21: failed object rendered differently for uploader vs other', () => {
  it('uploader sees "Upload failed" with Retry and Remove', () => {
    const image = makeImage({ status: 'failed' });
    render(
      <ImageObjectDirect
        image={image}
        isUploader={true}
        progress={undefined}
        canRetry={true}
        now={2000}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('other identity sees "Image unavailable"', () => {
    const image = makeImage({ status: 'failed' });
    render(
      <ImageObjectDirect
        image={image}
        isUploader={false}
        progress={undefined}
        canRetry={false}
        now={2000}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});

describe('TC-22: uploading object older than IMAGE_UPLOAD_STALE_MS', () => {
  it("shows 'Image upload didn't finish' with Remove; Remove deletes", () => {
    const onRemove = vi.fn();
    const image = makeImage({
      status: 'uploading',
      uploadStartedAt: 1000,
    });
    const now = 1000 + IMAGE_UPLOAD_STALE_MS + 1;
    render(
      <ImageObjectDirect
        image={image}
        isUploader={true}
        progress={undefined}
        canRetry={false}
        now={now}
        onRetry={vi.fn()}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    const removeBtn = screen.getByRole('button', { name: 'Remove' });
    fireEvent.click(removeBtn);
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe('TC-23: ready image fires error → "Image unavailable" box same size', () => {
  it('img error shows unavailable placeholder', () => {
    const image = makeImage({
      status: 'ready',
      assetKey: 'abcdefghijklmnopqrstuv/ABCDEFGHIJKLMNOPQRSTUV',
      width: 300,
      height: 200,
    });
    render(
      <ImageObjectDirect
        image={image}
        isUploader={true}
        progress={undefined}
        canRetry={false}
        now={2000}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );

    // Initially shows the img element
    const img = screen.getByTestId('image-ready');
    expect(img).toBeTruthy();

    // Fire error event
    fireEvent.error(img);

    // Now shows unavailable (fills the container which is sized by the outer wrapper)
    const unavailable = screen.getByTestId('image-unavailable');
    expect(unavailable).toBeTruthy();
    expect(unavailable.style.width).toBe('100%');
    expect(unavailable.style.height).toBe('100%');
  });
});

describe('TC-24: Retry with file in memory vs after reload', () => {
  it('canRetry=true shows Retry button, clicking calls onRetry', () => {
    const onRetry = vi.fn();
    const image = makeImage({ status: 'failed' });
    render(
      <ImageObjectDirect
        image={image}
        isUploader={true}
        progress={undefined}
        canRetry={true}
        now={2000}
        onRetry={onRetry}
        onRemove={vi.fn()}
      />,
    );
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retryBtn);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('canRetry=false hides Retry, only shows Remove', () => {
    const image = makeImage({ status: 'failed' });
    render(
      <ImageObjectDirect
        image={image}
        isUploader={true}
        progress={undefined}
        canRetry={false}
        now={2000}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});
