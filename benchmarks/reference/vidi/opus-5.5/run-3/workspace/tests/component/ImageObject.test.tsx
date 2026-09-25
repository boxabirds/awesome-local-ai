// image.object render states in jsdom: the ImageObject component directly (per identity and state) and in the real
// App on a real Y.Doc (Remove, Retry, image load errors). `uploadImage` is mocked and `createImageBitmap` stubbed.
import { act, createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { ImageObject } from '../../src/client/objects/ImageObject';
import type { UploadResult } from '../../src/client/images/uploadImage';
import { initDoc, objectSnapshot } from '../../src/shared/board-model';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { createImagePlaceholders, isImage, markImageFailed, markImageReady, type ImageSnap } from '../../src/shared/objects/image';

const uploads: Array<{ file: File; resolve(r: UploadResult): void }> = [];

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn((_boardId: string, file: File) => {
    let resolve!: (r: UploadResult) => void;
    const promise = new Promise<UploadResult>((r) => (resolve = r));
    uploads.push({ file, resolve });
    return { promise, abort: () => resolve({ kind: 'failed' }) };
  }),
}));

const KEY = 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB';

function snap(over: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 0,
    y: 0,
    width: 320,
    height: 200,
    z: 1,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 320,
    naturalHeight: 200,
    status: 'uploading',
    uploadStartedAt: 1_000_000,
    uploaderId: 'leo',
    ...over,
  };
}

function renderState(image: ImageSnap, opts: { isUploader: boolean; canRetry?: boolean; now?: number; progress?: number }) {
  const onRetry = vi.fn();
  const onRemove = vi.fn();
  render(
    <ImageObject
      image={image}
      isUploader={opts.isUploader}
      canRetry={opts.canRetry ?? true}
      progress={opts.progress}
      now={opts.now ?? image.uploadStartedAt + 1000}
      onRetry={onRetry}
      onRemove={onRemove}
    />,
  );
  return { onRetry, onRemove };
}

function images(doc: Y.Doc): ImageSnap[] {
  return objectSnapshot(doc).filter(isImage);
}

function imageEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-image-id="${id}"]`);
  if (!el) throw new Error(`image ${id} not rendered`);
  return el;
}

const item = { rect: { x: 0, y: 0, width: 320, height: 200 }, naturalWidth: 320, naturalHeight: 200, contentType: 'image/png' };

beforeEach(() => {
  uploads.length = 0;
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 320, height: 200, close() {} })));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('image.object: states', () => {
  it('uploading: the uploader sees progress, others see "Uploading…"', () => {
    renderState(snap(), { isUploader: true, progress: 0.3 });
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '30');
    document.body.innerHTML = '';
    renderState(snap(), { isUploader: false });
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('TC-21 failed: the uploader sees "Upload failed" with Retry and Remove; another identity sees "Image unavailable"', () => {
    const { onRetry, onRemove } = renderState(snap({ status: 'failed' }), { isUploader: true });
    expect(screen.getByText('Upload failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    document.body.innerHTML = '';
    renderState(snap({ status: 'failed' }), { isUploader: false });
    expect(screen.getByText('Image unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Upload failed')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('TC-22 uploading for longer than IMAGE_UPLOAD_STALE_MS: "Image upload didn\'t finish" with Remove, for anyone', () => {
    const image = snap({ uploaderId: 'someone-else' });
    renderState(image, { isUploader: false, now: image.uploadStartedAt + IMAGE_UPLOAD_STALE_MS - 1 });
    expect(screen.getByText('Uploading…')).toBeInTheDocument();
    document.body.innerHTML = '';
    const { onRemove } = renderState(image, { isUploader: false, now: image.uploadStartedAt + IMAGE_UPLOAD_STALE_MS + 1 });
    expect(screen.getByText("Image upload didn't finish")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('TC-22 in the board: a stale placeholder from someone else is removed by Remove', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const [id] = createImagePlaceholders(doc, [item], 'sam', Date.now() - IMAGE_UPLOAD_STALE_MS - 1);
    render(<App doc={doc} identityId="leo" />);
    const el = imageEl(id);
    expect(within(el).getByText("Image upload didn't finish")).toBeInTheDocument();
    expect(el).toHaveAttribute('data-status', 'unfinished');
    fireEvent.click(within(el).getByRole('button', { name: 'Remove' }));
    expect(images(doc)).toEqual([]);
  });

  it('a stale placeholder turns unfinished on its own while the board is open', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    const doc = new Y.Doc();
    initDoc(doc);
    const [id] = createImagePlaceholders(doc, [item], 'sam', Date.now());
    render(<App doc={doc} identityId="leo" />);
    expect(within(imageEl(id)).getByText('Uploading…')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(IMAGE_UPLOAD_STALE_MS + 30_000);
    });
    expect(within(imageEl(id)).getByText("Image upload didn't finish")).toBeInTheDocument();
  });

  it('TC-23 a ready image that fails to load shows "Image unavailable" in a box of the same size', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const [id] = createImagePlaceholders(doc, [item], 'sam', Date.now());
    markImageReady(doc, id, KEY);
    render(<App doc={doc} identityId="leo" />);
    const el = imageEl(id);
    const img = within(el).getByRole('img', { name: 'Image' });
    expect(img).toHaveAttribute('src', `/api/assets/${KEY}`);
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    fireEvent(img, createEvent.error(img));
    expect(within(el).getByText('Image unavailable')).toBeInTheDocument();
    expect(el.style.width).toBe('320px');
    expect(el.style.height).toBe('200px');
    expect(el).toHaveAccessibleName('Image');
  });
});

describe('image.object: Retry', () => {
  function drop(viewport: HTMLElement) {
    const file = new File([new Uint8Array(8)], 'shot.png', { type: 'image/png' });
    const event = createEvent.drop(viewport, { dataTransfer: { types: ['Files'], files: [file] } });
    Object.defineProperty(event, 'clientX', { value: 50 });
    Object.defineProperty(event, 'clientY', { value: 50 });
    fireEvent(viewport, event);
    return file;
  }

  async function settle() {
    await act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
  }

  it('TC-24 Retry with the file in memory uploads the same file again; after a reload only Remove is offered', async () => {
    const doc = new Y.Doc();
    const first = render(<App doc={doc} identityId="leo" />);
    const file = drop(screen.getByTestId('board-viewport'));
    await settle();
    const [img] = images(doc);
    await act(async () => uploads[0].resolve({ kind: 'failed', status: 500 }));
    const el = imageEl(img.id);
    expect(within(el).getByText('Upload failed')).toBeInTheDocument();

    fireEvent.click(within(el).getByRole('button', { name: 'Retry' }));
    expect(images(doc)[0].status).toBe('uploading');
    expect(uploads).toHaveLength(2);
    expect(uploads[1].file).toBe(file);
    await act(async () => uploads[1].resolve({ kind: 'failed' }));
    expect(images(doc)[0].status).toBe('failed');

    // A reload loses the kept file: the same uploader sees the failure with Remove only.
    first.unmount();
    render(<App doc={doc} identityId="leo" />);
    const again = imageEl(img.id);
    expect(within(again).getByText('Upload failed')).toBeInTheDocument();
    expect(within(again).queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(within(again).getByRole('button', { name: 'Remove' }));
    expect(images(doc)).toEqual([]);
  });

  it('another participant never sees Retry for a failed image', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const [id] = createImagePlaceholders(doc, [item], 'sam', Date.now());
    markImageFailed(doc, id);
    render(<App doc={doc} identityId="leo" />);
    expect(within(imageEl(id)).getByText('Image unavailable')).toBeInTheDocument();
    expect(within(imageEl(id)).queryByRole('button')).toBeNull();
  });
});
