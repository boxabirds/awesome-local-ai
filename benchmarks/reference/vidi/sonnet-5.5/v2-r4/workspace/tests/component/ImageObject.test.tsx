import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { snapshot } from '../../src/shared/board-model';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { createImagePlaceholders, markImageFailed, markImageReady, type ImageSnap } from '../../src/shared/objects/image';
import { ImageInsertContext } from '../../src/client/images/imageContext';
import { ImageObject, ImageObjectHost } from '../../src/client/objects/ImageObject';

const base: ImageSnap = {
  id: 'i1',
  type: 'image',
  x: 10,
  y: 20,
  width: 200,
  height: 100,
  z: 1,
  createdAt: 0,
  assetKey: null,
  contentType: 'image/png',
  naturalWidth: 400,
  naturalHeight: 200,
  status: 'uploading',
  uploadStartedAt: 1000,
  uploaderId: 'g_me',
};
afterEach(cleanup);
const noop = () => {};
const view = (image: Partial<ImageSnap>, p: Partial<Parameters<typeof ImageObject>[0]> = {}) =>
  render(<ImageObject image={{ ...base, ...image }} isUploader canRetry={false} now={2000} onRetry={noop} onRemove={noop} {...p} />);

describe('ImageObject', () => {
  it('uploader sees a progress percentage, others "Uploading…"', () => {
    view({}, { progress: 0.42 });
    expect(screen.getByText('42%')).toBeTruthy();
    view({}, { isUploader: false });
    expect(screen.getByText('Uploading…')).toBeTruthy();
  });

  it('TC-21: failed shows Retry and Remove to the uploader, "Image unavailable" to others', () => {
    const onRetry = vi.fn();
    const onRemove = vi.fn();
    const { unmount } = view({ status: 'failed' }, { canRetry: true, onRetry, onRemove });
    expect(screen.getByText('Upload failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRetry).toHaveBeenCalled();
    expect(onRemove).toHaveBeenCalled();
    unmount();
    view({ status: 'failed' }, { isUploader: false });
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('TC-22: a stale upload reads "Image upload didn\'t finish" with Remove for anyone', () => {
    const onRemove = vi.fn();
    view({}, { isUploader: false, now: base.uploadStartedAt + IMAGE_UPLOAD_STALE_MS + 1, onRemove });
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('TC-23: a load error swaps in the "Image unavailable" box', () => {
    view({ status: 'ready', assetKey: 'A/B' });
    const img = screen.getByAltText('Image') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/api/assets/A/B');
    expect(img.draggable).toBe(false);
    fireEvent.error(img);
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByAltText('Image')).toBeNull();
  });

  it('Retry is hidden when the file is no longer in memory', () => {
    view({ status: 'failed' }, { canRetry: false });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });
});

describe('ImageObjectHost', () => {
  function host(doc: Y.Doc, ctx: Partial<React.ContextType<typeof ImageInsertContext>> = {}) {
    const obj = snapshot(doc)[0] as ImageSnap;
    return (
      <ImageInsertContext.Provider value={{ identityId: 'g_me', progress: new Map(), canRetry: () => false, retry: () => false, ...ctx }}>
        <ImageObjectHost object={obj} doc={doc} editable zoom={1} selected={false} editing={false} onObjectPointerDown={noop} onStartEdit={noop} onEndEdit={noop} />
      </ImageInsertContext.Provider>
    );
  }
  const item = { rect: { x: 5, y: 6, width: 120, height: 60 }, naturalWidth: 120, naturalHeight: 60, contentType: 'image/png' };

  it('is announced as Image and sits at the object rect', () => {
    const doc = new Y.Doc();
    createImagePlaceholders(doc, [item], 'g_me', Date.now());
    render(host(doc));
    const el = screen.getByRole('group', { name: 'Image' });
    expect(el.style.left).toBe('5px');
    expect(el.style.width).toBe('120px');
  });

  it('TC-22: Remove on an abandoned upload deletes the object', () => {
    const doc = new Y.Doc();
    createImagePlaceholders(doc, [item], 'g_other', Date.now() - IMAGE_UPLOAD_STALE_MS - 1000);
    render(host(doc));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-24: Retry calls the hook while the file is in memory, and is hidden after a reload', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, [item], 'g_me', Date.now());
    markImageFailed(doc, id);
    const retry = vi.fn(() => true);
    const { rerender } = render(host(doc, { canRetry: () => true, retry }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledWith(id);
    rerender(host(doc, { canRetry: () => false, retry }));
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('a ready image shows the stored asset', () => {
    const doc = new Y.Doc();
    const [id] = createImagePlaceholders(doc, [item], 'g_me', Date.now());
    markImageReady(doc, id, 'K/V');
    render(host(doc));
    expect(screen.getByAltText('Image').getAttribute('src')).toBe('/api/assets/K/V');
  });

  it('re-renders on the 30 s clock so an abandoned upload becomes unfinished', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    createImagePlaceholders(doc, [item], 'g_other', Date.now() - IMAGE_UPLOAD_STALE_MS + 10_000);
    render(host(doc));
    expect(screen.getByText('Uploading…')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
    vi.useRealTimers();
  });
});
