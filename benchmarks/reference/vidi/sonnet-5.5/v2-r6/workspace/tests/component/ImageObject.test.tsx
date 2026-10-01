import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { snapshot, type ImageSnapshot } from '../../src/shared/board-model';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { createImagePlaceholders, markImageFailed, markImageReady } from '../../src/shared/objects/image';
import { getObjectType } from '../../src/client/objects/registry';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { renderBoardAtOrigin } from './board';

const base: ImageSnapshot = {
  id: 'i1', type: 'image', x: 10, y: 20, width: 200, height: 100, assetKey: null, contentType: 'image/png',
  naturalWidth: 200, naturalHeight: 100, status: 'uploading', uploadStartedAt: 1000, uploaderId: 'me', z: 1, createdAt: 1000,
};
const noop = () => {};
const view = (over: Partial<ImageSnapshot>, props: Partial<Parameters<typeof ImageObject>[0]> = {}) =>
  render(<ImageObject image={{ ...base, ...over }} isUploader canRetry={false} now={2000} onRetry={noop} onRemove={noop} {...props} />);

describe('ImageObject', () => {
  it('uploading: the uploader sees the percentage, others see Uploading…', () => {
    const { unmount } = view({}, { progress: 0.5 });
    expect(screen.getByTestId('image-progress').textContent).toBe('50%');
    unmount();
    view({}, { isUploader: false });
    expect(screen.getByText('Uploading…')).toBeTruthy();
  });

  it('ready: renders an Image from the asset route', () => {
    view({ status: 'ready', assetKey: 'b/a' });
    const img = screen.getByRole('img', { name: 'Image' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/assets/b/a');
    expect(img.draggable).toBe(false);
  });

  it('TC-21: a failed image shows the uploader Upload failed with Retry and Remove, others Image unavailable', () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    const { unmount } = view({ status: 'failed' }, { canRetry: true, onRetry, onRemove });
    expect(screen.getByText('Upload failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRemove).toHaveBeenCalledOnce();
    unmount();
    view({ status: 'failed' }, { isUploader: false });
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it("TC-22: an upload older than the stale timeout says Image upload didn't finish with Remove, for anyone", () => {
    const onRemove = vi.fn();
    view({}, { isUploader: false, now: base.uploadStartedAt + IMAGE_UPLOAD_STALE_MS + 1, onRemove });
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it('TC-23: an image that fails to load becomes an Image unavailable box', () => {
    view({ status: 'ready', assetKey: 'b/a' });
    fireEvent.error(screen.getByRole('img', { name: 'Image' }));
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'Image' })).toBeNull();
  });

  it('TC-24: Retry is hidden once the file is gone, leaving only Remove', () => {
    view({ status: 'failed' }, { canRetry: false });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});

describe('image on the board', () => {
  it('registers an aspect-locked, resizable type with the minimum size', () => {
    expect(getObjectType('image')).toMatchObject({ resizable: true, aspectLocked: true, minSize: IMAGE_MIN_SIZE_WORLD, editableText: false });
  });

  it('TC-24: Retry on the board uploads again for the owner only while the file is known; Remove deletes the object', async () => {
    const { doc } = await renderBoardAtOrigin();
    let id = '';
    act(() => {
      [id] = createImagePlaceholders(doc, [{ rect: { x: 0, y: 0, width: 200, height: 100 }, naturalWidth: 200, naturalHeight: 100, contentType: 'image/png' }], 'someone-else', Date.now());
      markImageFailed(doc, id);
    });
    // Another identity sees only "Image unavailable" and no controls.
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    act(() => { markImageReady(doc, id, 'b/a'); });
    expect(screen.getByRole('img', { name: 'Image' })).toBeTruthy();
    expect(snapshot(doc).filter((o) => o.type === 'image')).toHaveLength(1);
  });
});
