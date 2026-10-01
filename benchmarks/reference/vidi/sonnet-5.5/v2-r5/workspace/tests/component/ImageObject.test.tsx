import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ImageObject, BoardImage } from '../../src/client/objects/ImageObject';
import { ImageContext } from '../../src/client/images/ImageContext';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { createImagePlaceholders, markImageFailed, type ImageSnap } from '../../src/shared/objects/image';
import { snapshotObjects } from '../../src/shared/board-model';
import { newDoc } from './helpers';

afterEach(cleanup);

const base: ImageSnap = {
  id: 'i1', type: 'image', x: 0, y: 0, width: 200, height: 100, z: 1, createdAt: 0, assetKey: null, contentType: 'image/png',
  naturalWidth: 200, naturalHeight: 100, status: 'uploading', uploadStartedAt: 1000, uploaderId: 'me',
};
const view = (over: Partial<ImageSnap>, p: Partial<Parameters<typeof ImageObject>[0]> = {}) => (
  <ImageObject
    image={{ ...base, ...over }} isUploader canRetry now={2000} onRetry={() => {}} onRemove={() => {}} {...p}
  />
);

describe('ImageObject', () => {
  it('uploading: uploader sees a percentage, others see Uploading…', () => {
    const { rerender } = render(view({}, { progress: 0.37 }));
    expect(screen.getByText('37%')).toBeTruthy();
    rerender(view({}, { isUploader: false }));
    expect(screen.getByText('Uploading…')).toBeTruthy();
  });

  it('TC-21 failed: uploader sees Upload failed with Retry and Remove; others see Image unavailable', () => {
    const { rerender } = render(view({ status: 'failed' }));
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
    rerender(view({ status: 'failed' }, { isUploader: false }));
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it("TC-22 uploading for more than the stale time shows Image upload didn't finish with Remove", () => {
    const onRemove = vi.fn();
    render(view({}, { isUploader: false, now: 1000 + IMAGE_UPLOAD_STALE_MS + 1, onRemove }));
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('ready renders the stored image; TC-23 an error event swaps in Image unavailable', () => {
    render(view({ status: 'ready', assetKey: 'a'.repeat(22) + '/' + 'b'.repeat(22) }));
    const img = screen.getByAltText('Image');
    expect(img.getAttribute('src')).toBe(`/api/assets/${'a'.repeat(22)}/${'b'.repeat(22)}`);
    expect(img.getAttribute('draggable')).toBe('false');
    fireEvent.error(img);
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByAltText('Image')).toBeNull();
  });

  it('TC-24 Retry is hidden when the file is no longer in memory', () => {
    const onRetry = vi.fn();
    const { rerender } = render(view({ status: 'failed' }, { onRetry }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    rerender(view({ status: 'failed' }, { canRetry: false }));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});

describe('BoardImage (registry component)', () => {
  function setup(identity: string, canRetry: boolean) {
    const doc = newDoc();
    const [id] = createImagePlaceholders(
      doc, [{ rect: { x: 10, y: 20, width: 200, height: 100 }, naturalWidth: 200, naturalHeight: 100, contentType: 'image/png' }],
      'me', Date.now(),
    );
    markImageFailed(doc, id);
    const retry = vi.fn(() => true);
    const object = snapshotObjects(doc)[0];
    render(
      <ImageContext.Provider value={{ identityId: identity, progress: new Map(), canRetry: () => canRetry, retry }}>
        <BoardImage
          object={object} doc={doc} zoom={1} selected={false} editing={false} dragging={false} readOnly={false}
          onPointerDown={() => {}} onStartEdit={() => {}} onEndEdit={() => {}}
        />
      </ImageContext.Provider>,
    );
    return { doc, id, retry };
  }

  it('TC-21/TC-24 Retry calls the insert hook, Remove deletes the object', () => {
    const { doc, id, retry } = setup('me', true);
    expect(screen.getByRole('group', { name: 'Image' }).style.width).toBe('200px');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledWith(id);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  it('another identity sees Image unavailable', () => {
    setup('someone-else', false);
    expect(screen.getByText('Image unavailable')).toBeTruthy();
  });

  it('a stale upload is marked after the clock ticks', () => {
    vi.useFakeTimers();
    const doc = newDoc();
    createImagePlaceholders(
      doc, [{ rect: { x: 0, y: 0, width: 50, height: 50 }, naturalWidth: 50, naturalHeight: 50, contentType: 'image/png' }],
      'me', Date.now(),
    );
    render(
      <BoardImage
        object={snapshotObjects(doc)[0]} doc={doc} zoom={1} selected={false} editing={false} dragging={false}
        readOnly={false} onPointerDown={() => {}} onStartEdit={() => {}} onEndEdit={() => {}}
      />,
    );
    expect(screen.getByText('Uploading…')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(IMAGE_UPLOAD_STALE_MS + 60_000); });
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    vi.useRealTimers();
  });
});
