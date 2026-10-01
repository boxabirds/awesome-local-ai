import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import type { ImageSnap } from '../../src/shared/objects/image';
import { ImageObject } from '../../src/client/objects/ImageObject';

const image = (over: Partial<ImageSnap> = {}): ImageSnap => ({
  id: 'i1',
  type: 'image',
  x: 10,
  y: 20,
  width: 200,
  height: 100,
  z: 1,
  createdAt: 0,
  assetKey: 'board/asset',
  contentType: 'image/png',
  naturalWidth: 400,
  naturalHeight: 200,
  status: 'ready',
  uploadStartedAt: 1000,
  uploaderId: 'me',
  ...over,
});

const props = (over: Partial<Parameters<typeof ImageObject>[0]> = {}) => ({
  image: image(),
  isUploader: true,
  canRetry: true,
  now: 2000,
  onRetry: vi.fn(),
  onRemove: vi.fn(),
  ...over,
});

afterEach(cleanup);

describe('ImageObject', () => {
  it('shows the stored image, announced as Image', () => {
    render(<ImageObject {...props()} />);
    const img = screen.getByRole('img', { name: 'Image' });
    expect(img.getAttribute('src')).toBe('/api/assets/board/asset');
  });

  it('uploading: the uploader sees a percentage, others see Uploading…', () => {
    const { unmount } = render(<ImageObject {...props({ image: image({ status: 'uploading', assetKey: null }), progress: 0.42 })} />);
    expect(screen.getByText('42%')).toBeTruthy();
    unmount();
    render(<ImageObject {...props({ image: image({ status: 'uploading', assetKey: null }), isUploader: false })} />);
    expect(screen.getByText('Uploading…')).toBeTruthy();
  });

  it('TC-21: failed shows Retry and Remove to the uploader, Image unavailable to others', () => {
    const failed = image({ status: 'failed' });
    const { unmount } = render(<ImageObject {...props({ image: failed })} />);
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    unmount();
    render(<ImageObject {...props({ image: failed, isUploader: false })} />);
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('TC-22: an old upload is unfinished for everyone and can be removed', () => {
    const onRemove = vi.fn();
    render(
      <ImageObject
        {...props({
          image: image({ status: 'uploading', assetKey: null }),
          isUploader: false,
          now: 1000 + IMAGE_UPLOAD_STALE_MS + 1,
          onRemove,
        })}
      />,
    );
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('TC-23: a load error swaps in an Image unavailable box of the same size', () => {
    render(<ImageObject {...props()} />);
    fireEvent.error(screen.getByRole('img', { name: 'Image' }));
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    const box = screen.getByRole('group', { name: 'Image' });
    expect(box.style.width).toBe('200px');
    expect(box.style.height).toBe('100px');
  });

  it('TC-24: Retry calls back while the file is in memory and is hidden after a reload', () => {
    const onRetry = vi.fn();
    const failed = image({ status: 'failed' });
    const { unmount } = render(<ImageObject {...props({ image: failed, onRetry })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
    unmount();
    render(<ImageObject {...props({ image: failed, canRetry: false })} />);
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});
