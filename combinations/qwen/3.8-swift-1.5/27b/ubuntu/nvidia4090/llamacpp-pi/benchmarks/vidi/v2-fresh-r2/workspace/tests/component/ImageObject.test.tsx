/**
 * Component tests for the image object render states (story 12, image.object).
 * TC-21 to TC-24.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

function imageSnap(partial: Partial<ImageSnap>): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 0,
    y: 0,
    z: 0,
    createdAt: 0,
    width: 100,
    height: 100,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 100,
    naturalHeight: 100,
    status: 'uploading',
    uploadStartedAt: 0,
    uploaderId: 'me',
    ...partial,
  };
}

describe('image.object: ImageObject states', () => {
  // TC-21: failed as uploader → "Upload failed" + Retry + Remove; other → unavailable.
  it('TC-21: a failed image shows Retry/Remove to the uploader, unavailable to others', () => {
    const failed = imageSnap({ status: 'failed' });

    const first = render(
      <ImageObject image={failed} isUploader canRetry now={0} onRetry={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText('Upload failed')).toBeDefined();
    expect(screen.getByTestId('image-retry')).toBeDefined();
    expect(screen.getByTestId('image-remove')).toBeDefined();
    first.unmount();

    render(
      <ImageObject
        image={imageSnap({ status: 'failed', uploaderId: 'someone-else' })}
        isUploader={false}
        canRetry={false}
        now={0}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Image unavailable')).toBeDefined();
    expect(screen.queryByTestId('image-retry')).toBeNull();
  });

  // TC-22: uploading older than STALE_MS → "Image upload didn't finish" + Remove.
  it('TC-22: an upload older than the stale window is unfinished with a Remove', () => {
    const started = 1_000_000;
    const img = imageSnap({ status: 'uploading', uploadStartedAt: started, uploaderId: 'someone-else' });
    const onRemove = vi.fn();
    render(
      <ImageObject
        image={img}
        isUploader={false}
        canRetry={false}
        now={started + IMAGE_UPLOAD_STALE_MS + 1}
        onRetry={vi.fn()}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByText("Image upload didn't finish")).toBeDefined();
    fireEvent.click(screen.getByTestId('image-remove'));
    expect(onRemove).toHaveBeenCalled();
  });

  // TC-23: a ready image that fails to load → "Image unavailable".
  it('TC-23: a ready image that errors degrades to the unavailable box', () => {
    const ready = imageSnap({ status: 'ready', assetKey: 'b/a' });
    render(
      <ImageObject image={ready} isUploader canRetry={false} now={0} onRetry={vi.fn()} onRemove={vi.fn()} />,
    );
    const img = screen.getByTestId('image-ready');
    expect(img).toHaveAttribute('src', '/api/assets/b/a');
    fireEvent.error(img);
    expect(screen.getByText('Image unavailable')).toBeDefined();
    expect(screen.queryByTestId('image-ready')).toBeNull();
  });

  // TC-24: Retry (canRetry) calls onRetry; without the file, Retry is hidden.
  it('TC-24: Retry calls onRetry when the file is in memory, hidden otherwise', () => {
    const failed = imageSnap({ status: 'failed' });
    const onRetry = vi.fn();
    const first = render(
      <ImageObject image={failed} isUploader canRetry now={0} onRetry={onRetry} onRemove={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('image-retry'));
    expect(onRetry).toHaveBeenCalled();
    first.unmount();

    render(
      <ImageObject image={failed} isUploader canRetry={false} now={0} onRetry={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeDefined();
  });

  // Uploading states: uploader sees progress, others see "Uploading…".
  it('uploading shows progress to the uploader and a label to others', () => {
    render(
      <ImageObject
        image={imageSnap({ status: 'uploading' })}
        isUploader
        progress={0.42}
        canRetry={false}
        now={0}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByTestId('image-progress-label')).toHaveTextContent('42%');

    render(
      <ImageObject
        image={imageSnap({ status: 'uploading', uploaderId: 'someone-else' })}
        isUploader={false}
        canRetry={false}
        now={0}
        onRetry={vi.fn()}
        onRemove={vi.fn()}
      />,
    );
    expect(screen.getByText('Uploading…')).toBeDefined();
  });
});
