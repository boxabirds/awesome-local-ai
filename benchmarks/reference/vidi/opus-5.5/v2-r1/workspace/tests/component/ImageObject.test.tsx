// image.object (TC-21 to TC-24): render states per displayStatus and identity, Retry and Remove.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { uploadImage } from '../../src/client/images/uploadImage';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { initDoc } from '../../src/shared/board-model';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { type ImageSnap, createImagePlaceholders, markImageFailed, markImageReady } from '../../src/shared/objects/image';
import { dropFiles, fakeUploads, finish, imageFile, imagesOf, stubBitmaps } from './imageHelpers';
import { renderApp } from './stickyHelpers';

vi.mock('../../src/client/images/uploadImage', () => ({ uploadImage: vi.fn() }));

let uploads: ReturnType<typeof fakeUploads>;
beforeEach(() => {
  stubBitmaps();
  uploads = fakeUploads();
  vi.mocked(uploadImage).mockImplementation(uploads.impl);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.mocked(uploadImage).mockReset();
});

const KEY = 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB';

function snap(over: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 10,
    y: 20,
    width: 320,
    height: 240,
    z: 1,
    createdAt: 0,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 640,
    naturalHeight: 480,
    status: 'uploading',
    uploadStartedAt: 1000,
    uploaderId: 'g_leo',
    ...over,
  };
}

function renderImage(image: ImageSnap, over: Partial<Parameters<typeof ImageObject>[0]> = {}) {
  const onRetry = vi.fn();
  const onRemove = vi.fn();
  const result = render(
    <ImageObject image={image} isUploader canRetry now={2000} onRetry={onRetry} onRemove={onRemove} {...over} />,
  );
  const el = document.querySelector<HTMLElement>(`[data-image-id="${image.id}"]`)!;
  return { ...result, el, onRetry, onRemove };
}

const button = (name: string) => screen.queryByRole<HTMLButtonElement>('button', { name });

describe('image.object states', () => {
  it('uploading: progress for the uploader, "Uploading…" for others, same size and place', () => {
    const { el, unmount } = renderImage(snap(), { progress: 0.42 });
    expect(el.textContent).toContain('42%');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42');
    expect(el.style.width).toBe('320px');
    unmount();
    const other = renderImage(snap(), { isUploader: false });
    expect(other.el.textContent).toBe('Uploading…');
    expect([other.el.style.left, other.el.style.top, other.el.style.width, other.el.style.height]).toEqual([
      '10px',
      '20px',
      '320px',
      '240px',
    ]);
    expect(screen.getByRole('group', { name: 'Image' })).toBe(other.el);
  });

  it('TC-21 failed: Upload failed with Retry and Remove for the uploader; Image unavailable for others', () => {
    const { el, onRetry, onRemove, unmount } = renderImage(snap({ status: 'failed' }));
    expect(el.textContent).toContain('Upload failed');
    expect(el.className).toContain('is-upload-failed');
    fireEvent.click(button('Retry')!);
    fireEvent.click(button('Remove')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    unmount();

    const other = renderImage(snap({ status: 'failed' }), { isUploader: false });
    expect(other.el.textContent).toBe('Image unavailable');
    expect(button('Retry')).toBeNull();
    expect(button('Remove')).toBeNull();
  });

  it('TC-22 uploading longer than IMAGE_UPLOAD_STALE_MS: "Image upload didn\'t finish" with Remove for anyone', () => {
    const image = snap({ uploadStartedAt: 1000 });
    const { el, rerender, onRemove } = renderImage(image, { isUploader: false, now: 1000 + IMAGE_UPLOAD_STALE_MS });
    expect(el.textContent).toBe('Uploading…');
    rerender(
      <ImageObject
        image={image}
        isUploader={false}
        canRetry={false}
        now={1000 + IMAGE_UPLOAD_STALE_MS + 1}
        onRetry={() => {}}
        onRemove={onRemove}
      />,
    );
    expect(el.textContent).toContain("Image upload didn't finish");
    fireEvent.click(button('Remove')!);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('TC-22 on the board: an abandoned upload turns unfinished without interaction; Remove deletes it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const doc = new Y.Doc();
    initDoc(doc);
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 80 }, naturalWidth: 100, naturalHeight: 80, contentType: 'image/png' }],
      'g_someone_else',
      Date.now(),
    );
    renderApp(doc);
    const el = document.querySelector<HTMLElement>(`[data-image-id="${id}"]`)!;
    expect(el.textContent).toBe('Uploading…');
    act(() => {
      vi.advanceTimersByTime(IMAGE_UPLOAD_STALE_MS + 1);
    });
    expect(el.textContent).toContain("Image upload didn't finish");
    fireEvent.click(button('Remove')!);
    expect(imagesOf(doc)).toHaveLength(0);
  });

  it('TC-23 a ready image that fails to load shows "Image unavailable" at the same size', () => {
    const { el } = renderImage(snap({ status: 'ready', assetKey: KEY }), { isUploader: false });
    const img = el.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`/api/assets/${KEY}`);
    expect(img.getAttribute('loading')).toBe('lazy');
    fireEvent.error(img);
    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toBe('Image unavailable');
    expect([el.style.width, el.style.height]).toEqual(['320px', '240px']);
    expect(el.dataset.status).toBe('ready');
  });

  it('TC-24 after a reload (file gone): only Remove', () => {
    renderImage(snap({ status: 'failed' }), { canRetry: false });
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(button('Retry')).toBeNull();
    expect(button('Remove')).toBeTruthy();
  });

  it('TC-24 Retry with the file in memory: uploading again with the same file', async () => {
    const { doc, viewport } = renderApp();
    const file = imageFile('a.png', 64, 48);
    await dropFiles(viewport, [file], { x: 10, y: 10 });
    await finish(uploads.calls[0], { kind: 'failed', status: 500 });
    const [img] = imagesOf(doc);
    expect(img.status).toBe('failed');
    const el = document.querySelector<HTMLElement>(`[data-image-id="${img.id}"]`)!;
    expect(el.textContent).toContain('Upload failed');

    fireEvent.click(button('Retry')!);
    expect(imagesOf(doc)[0].status).toBe('uploading');
    expect(imagesOf(doc)[0].uploadStartedAt).toBeGreaterThanOrEqual(img.uploadStartedAt);
    expect(uploads.calls).toHaveLength(2);
    expect(uploads.calls[1].file).toBe(file);
    await finish(uploads.calls[1], { kind: 'ok', assetKey: KEY });
    await waitFor(() => expect(imagesOf(doc)[0]).toMatchObject({ status: 'ready', assetKey: KEY }));
    // Retry and completion are not undo steps: one undo removes the image.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(imagesOf(doc)).toHaveLength(0);
  });

  it('remote status changes render live (ready and failed written by another client)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const [a, b] = createImagePlaceholders(
      doc,
      [0, 1].map((i) => ({
        rect: { x: i * 200, y: 0, width: 100, height: 80 },
        naturalWidth: 100,
        naturalHeight: 80,
        contentType: 'image/png',
      })),
      'g_other',
      Date.now(),
    );
    renderApp(doc);
    act(() => {
      markImageReady(doc, a, KEY);
      markImageFailed(doc, b);
    });
    expect(document.querySelector(`[data-image-id="${a}"] img`)).toBeTruthy();
    expect(document.querySelector(`[data-image-id="${b}"]`)!.textContent).toBe('Image unavailable');
  });
});
