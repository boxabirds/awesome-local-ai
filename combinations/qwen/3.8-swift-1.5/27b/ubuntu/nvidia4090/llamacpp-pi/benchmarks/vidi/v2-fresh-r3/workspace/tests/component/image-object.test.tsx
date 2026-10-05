/**
 * TC-21: image object rendering states (ui-component).
 *
 * Renders the ImageObject component directly with a synthetic snap.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { ImageSnap } from '../../src/shared/objects/image';

const KEY = 'a'.repeat(22) + '/' + 'b'.repeat(22);

function img(over: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 0,
    y: 0,
    width: 120,
    height: 90,
    z: 1,
    createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 120,
    naturalHeight: 90,
    status: 'uploading',
    uploadStartedAt: Date.now(),
    uploaderId: 'me',
    ...over,
  };
}

describe('TC-21: image object rendering (ui-component)', () => {
  it('uploading (uploader) → grey box with image icon and progress', () => {
    render(
      <ImageObject
        image={img()}
        isUploader
        progress={0.4}
        canRetry={false}
        now={Date.now()}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByTestId('image-uploading')).toBeTruthy();
    expect(screen.getByTestId('image-progress').textContent).toBe('40%');
  });

  it('uploading (not the uploader) → "Uploading…"', () => {
    render(<ImageObject image={img({ uploaderId: 'someone-else' })} isUploader={false} canRetry={false} now={Date.now()} onRetry={() => {}} onRemove={() => {}} />);
    expect(screen.getByTestId('image-uploading')).toBeTruthy();
    expect(screen.getByText('Uploading…')).toBeTruthy();
  });

  it('ready → the stored image element', () => {
    render(
      <ImageObject
        image={img({ status: 'ready', assetKey: KEY })}
        isUploader
        canRetry={false}
        now={Date.now()}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByTestId('image-ready').getAttribute('src')).toBe(`/api/assets/${KEY}`);
  });

  it('failed (uploader) → "Upload failed" with Retry and Remove', () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    render(
      <ImageObject
        image={img({ status: 'failed' })}
        isUploader
        canRetry
        now={Date.now()}
        onRetry={onRetry}
        onRemove={onRemove}
      />,
    );
    expect(screen.getByTestId('image-failed')).toBeTruthy();
    expect(screen.getByText('Upload failed')).toBeTruthy();

    screen.getByLabelText('Retry').click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    screen.getByLabelText('Remove').click();
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('failed (not the uploader) → "Image unavailable"', () => {
    render(
      <ImageObject
        image={img({ status: 'failed', uploaderId: 'someone-else' })}
        isUploader={false}
        canRetry={false}
        now={Date.now()}
        onRetry={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByTestId('image-unavailable')).toBeTruthy();
    expect(screen.queryByTestId('image-failed')).toBeNull();
  });
});
