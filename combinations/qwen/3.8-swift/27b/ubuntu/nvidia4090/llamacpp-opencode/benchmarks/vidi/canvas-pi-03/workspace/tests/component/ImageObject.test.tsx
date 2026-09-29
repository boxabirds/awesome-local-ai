/**
 * Story 12: the image object's render states (TC-29, image.upload_states).
 *
 * - uploading (uploader): grey box + progress bar + percentage;
 * - uploading (other):    "Uploading…";
 * - ready:                the stored image;
 * - failed (uploader):    "Upload failed" + Retry (file in memory) + Remove;
 * - failed (other):       "Image unavailable";
 * - unfinished:           "Image upload didn't finish" + Remove;
 * - ready but unloadable: "Image unavailable".
 */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ImageObject } from 'src/client/images/ImageObject';
import type { ImageSnap } from 'src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from 'src/shared/config';

function snap(over: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img1',
    type: 'image',
    x: 0,
    y: 0,
    z: 1,
    width: 800,
    height: 500,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 1440,
    naturalHeight: 900,
    status: 'uploading',
    uploadStartedAt: 1000,
    uploaderId: 'me',
    ...over,
  };
}

function renderImage(image: ImageSnap, extra: Partial<Record<string, unknown>> = {}): void {
  render(
    <ImageObject
      image={image}
      isUploader={image.uploaderId === 'me'}
      progress={0.4}
      canRetry={false}
      now={1000 + 1000}
      onRetry={() => {}}
      onRemove={() => {}}
      onPointerDown={() => {}}
      {...(extra as object)}
    />,
  );
}

describe('TC-29: render states', () => {
  it('uploading (uploader): progress bar with percentage', () => {
    renderImage(snap({ status: 'uploading' }));
    expect(screen.getByTestId('image-placeholder')).toBeDefined();
    expect(screen.getByTestId('image-upload-progress')).toBeDefined();
    expect(screen.getByText('40%')).toBeDefined();
  });

  it('uploading (other user): "Uploading…"', () => {
    renderImage(snap({ status: 'uploading', uploaderId: 'someone-else' }));
    expect(screen.getByTestId('image-uploading')).toBeDefined();
    expect(screen.getByText('Uploading…')).toBeDefined();
  });

  it('ready: renders the stored image', () => {
    renderImage(snap({ status: 'ready', assetKey: 'board/assetkey1234567890abcd' }));
    const img = screen.getByRole('img');
    expect(img).toHaveAttribute('src', '/api/assets/board/assetkey1234567890abcd');
  });

  it('failed (uploader): "Upload failed" with Retry and Remove', () => {
    renderImage(snap({ status: 'failed' }), { canRetry: true });
    expect(screen.getByTestId('image-failed')).toBeDefined();
    expect(screen.getByText('Upload failed')).toBeDefined();
    expect(screen.getByTestId('image-retry')).toBeDefined();
    expect(screen.getByTestId('image-remove')).toBeDefined();
  });

  it('failed (uploader, file gone after reload): no Retry button', () => {
    renderImage(snap({ status: 'failed' }), { canRetry: false });
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeDefined();
  });

  it('failed (other user): "Image unavailable"', () => {
    renderImage(snap({ status: 'failed', uploaderId: 'someone-else' }));
    expect(screen.getByTestId('image-unavailable')).toBeDefined();
    expect(screen.getByText('Image unavailable')).toBeDefined();
  });

  it('unfinished (stale): “Image upload didn’t finish” with Remove', () => {
    renderImage(
      snap({ status: 'uploading', uploadStartedAt: 0 }),
      { now: IMAGE_UPLOAD_STALE_MS + 1 },
    );
    expect(screen.getByTestId('image-unfinished')).toBeDefined();
    expect(screen.getByText("Image upload didn't finish")).toBeDefined();
    expect(screen.getByTestId('image-remove')).toBeDefined();
  });

  it('ready image that fails to load: degrades to "Image unavailable"', () => {
    renderImage(snap({ status: 'ready', assetKey: 'board/gone1234567890abcdef' }));
    const img = screen.getByRole('img');
    fireEvent.error(img);
    expect(screen.getByTestId('image-unavailable')).toBeDefined();
    expect(screen.getByText('Image unavailable')).toBeDefined();
  });
});
