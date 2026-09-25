/**
 * Story 12 image.object component tests (TC-21 to TC-24): render states by displayStatus and
 * identity, Remove and Retry. TC-22 and TC-24's retry run through the whole app on a real
 * Y.Doc with a mocked `uploadImage`.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { getObjectType } from '../../src/client/objects/registry';
import { snapshotObjects } from '../../src/shared/board-model';
import { createImagePlaceholders, markImageFailed, markImageReady, type ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { viewportEl } from './boardHelpers';
import { renderApp } from './shapeHelpers';
import { dropFiles, imageFile, images, settle, stubCreateImageBitmap, type PendingUpload } from './imageHelpers';

const uploads = vi.hoisted(() => [] as PendingUpload[]);
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn((boardId: string, file: File, onProgress: (f: number) => void) => {
    let resolve!: PendingUpload['resolve'];
    const promise = new Promise<Parameters<PendingUpload['resolve']>[0]>((r) => {
      resolve = r;
    });
    const pending: PendingUpload = { boardId, file, onProgress, resolve, aborted: false };
    uploads.push(pending);
    return { promise, abort: () => resolve({ kind: 'failed' }) };
  }),
}));

const NOW = 1_750_000_000_000;
const KEY = 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB';

function snap(over: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 10,
    y: 20,
    width: 400,
    height: 300,
    z: 1,
    createdAt: NOW,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 400,
    naturalHeight: 300,
    status: 'uploading',
    uploadStartedAt: NOW,
    uploaderId: 'g_leo',
    ...over,
  };
}

function renderImage(image: ImageSnap, opts: { isUploader?: boolean; canRetry?: boolean; now?: number; progress?: number } = {}) {
  const onRetry = vi.fn();
  const onRemove = vi.fn();
  render(
    <ImageObject
      image={image}
      isUploader={opts.isUploader ?? true}
      canRetry={opts.canRetry ?? true}
      progress={opts.progress}
      now={opts.now ?? NOW}
      onRetry={onRetry}
      onRemove={onRemove}
    />,
  );
  return { onRetry, onRemove, el: screen.getByRole('group', { name: 'Image' }) };
}

let doc: Y.Doc;
beforeEach(() => {
  doc = new Y.Doc();
  uploads.length = 0;
  stubCreateImageBitmap();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('image.object', () => {
  it('registry: image is resizable, aspect-locked, min IMAGE_MIN_SIZE_WORLD, no editable text', () => {
    expect(getObjectType('image')).toMatchObject({ resizable: true, aspectLocked: true, minSize: IMAGE_MIN_SIZE_WORLD, editableText: false });
  });

  it('uploading: the uploader sees a progress bar with a percentage; others see "Uploading…"', () => {
    const mine = renderImage(snap(), { progress: 0.42 });
    expect(within(mine.el).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
    expect(within(mine.el).getByText('42%')).toBeInTheDocument();
    expect(within(mine.el).queryByText('Uploading…')).toBeNull();
    expect(mine.el.style.width).toBe('400px');
    expect(mine.el.style.height).toBe('300px');
    document.body.innerHTML = '';
    const theirs = renderImage(snap(), { isUploader: false });
    expect(within(theirs.el).getByText('Uploading…')).toBeInTheDocument();
    expect(within(theirs.el).queryByRole('progressbar')).toBeNull();
  });

  it('TC-21 failed: the uploader sees Upload failed with Retry and Remove; another identity sees Image unavailable', () => {
    const mine = renderImage(snap({ status: 'failed' }));
    expect(within(mine.el).getByText('Upload failed')).toBeInTheDocument();
    fireEvent.click(within(mine.el).getByRole('button', { name: 'Retry' }));
    fireEvent.click(within(mine.el).getByRole('button', { name: 'Remove' }));
    expect(mine.onRetry).toHaveBeenCalledTimes(1);
    expect(mine.onRemove).toHaveBeenCalledTimes(1);
    document.body.innerHTML = '';

    const theirs = renderImage(snap({ status: 'failed' }), { isUploader: false });
    expect(within(theirs.el).getByText('Image unavailable')).toBeInTheDocument();
    expect(within(theirs.el).queryByRole('button')).toBeNull();
    expect(within(theirs.el).queryByText('Upload failed')).toBeNull();
  });

  it('TC-22 an upload older than IMAGE_UPLOAD_STALE_MS shows "Image upload didn\'t finish" + Remove; Remove deletes it', () => {
    const stale = snap({ uploadStartedAt: NOW - IMAGE_UPLOAD_STALE_MS - 1 });
    const direct = renderImage(stale, { isUploader: false });
    expect(within(direct.el).getByText("Image upload didn't finish")).toBeInTheDocument();
    document.body.innerHTML = '';
    const fresh = renderImage(snap({ uploadStartedAt: NOW - IMAGE_UPLOAD_STALE_MS + 1 }), { isUploader: false });
    expect(within(fresh.el).getByText('Uploading…')).toBeInTheDocument();
    document.body.innerHTML = '';

    // Through the app: someone else's abandoned upload on a board opened later.
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 400, height: 300 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/png' }],
      'g_someone_else',
      Date.now() - IMAGE_UPLOAD_STALE_MS - 1000,
    );
    renderApp(doc);
    const el = document.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    expect(within(el).getByText("Image upload didn't finish")).toBeInTheDocument();
    fireEvent.click(within(el).getByRole('button', { name: 'Remove' }));
    expect(snapshotObjects(doc)).toHaveLength(0);
  });

  it('TC-22 the clock ticks while an image is uploading, so unfinished appears without interaction', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'setInterval', 'clearInterval', 'Date'] });
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 400, height: 300 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/png' }],
      'g_someone_else',
      Date.now(),
    );
    render(<App doc={doc} />); // not renderApp: it would replace these fake timers
    const el = () => document.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    expect(within(el()).getByText('Uploading…')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(IMAGE_UPLOAD_STALE_MS + 30_000);
    });
    expect(within(el()).getByText("Image upload didn't finish")).toBeInTheDocument();
  });

  it('TC-23 a ready image that fails to load shows Image unavailable at the same size', () => {
    const { el } = renderImage(snap({ status: 'ready', assetKey: KEY }), { isUploader: false });
    const img = within(el).getByRole('img', { name: 'Image' });
    expect(img).toHaveAttribute('src', `/api/assets/${KEY}`);
    expect(img).toHaveAttribute('draggable', 'false');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    fireEvent.error(img);
    expect(within(el).queryByRole('img', { name: 'Image' })).toBeNull();
    expect(within(el).getByText('Image unavailable')).toBeInTheDocument();
    expect(el).toHaveAttribute('data-status', 'unavailable');
    expect(el.style.width).toBe('400px');
    expect(el.style.height).toBe('300px');
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
  });

  it('TC-24 Retry with the file in memory uploads the same file again; after a reload only Remove is offered', async () => {
    renderApp(doc);
    await dropFiles(viewportEl(), [imageFile('shot-a.png')], { x: 200, y: 200 });
    const [img] = images(doc);
    await settle(uploads[0]!, { kind: 'failed', status: 500 });
    expect(images(doc)[0]!.status).toBe('failed');
    const el = document.querySelector<HTMLElement>(`[data-id="${img!.id}"]`)!;
    expect(within(el).getByText('Upload failed')).toBeInTheDocument();

    fireEvent.click(within(el).getByRole('button', { name: 'Retry' }));
    expect(images(doc)[0]!.status).toBe('uploading');
    expect(uploads).toHaveLength(2);
    expect(uploads[1]!.file).toBe(uploads[0]!.file);
    await settle(uploads[1]!, { kind: 'ok', assetKey: KEY });
    expect(images(doc)[0]).toMatchObject({ status: 'ready', assetKey: KEY });
    expect(within(el).getByRole('img', { name: 'Image' })).toBeInTheDocument();

    // Simulated reload: the file is gone from memory.
    document.body.innerHTML = '';
    const reloaded = renderImage(snap({ status: 'failed' }), { canRetry: false });
    expect(within(reloaded.el).queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(within(reloaded.el).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('a remote image turns from placeholder into the image as soon as its address arrives', () => {
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 400, height: 300 }, naturalWidth: 400, naturalHeight: 300, contentType: 'image/png' }],
      'g_sam',
      Date.now(),
    );
    renderApp(doc);
    const el = () => document.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
    expect(within(el()).getByText('Uploading…')).toBeInTheDocument();
    act(() => {
      markImageReady(doc, id!, KEY);
    });
    expect(within(el()).getByRole('img', { name: 'Image' })).toHaveAttribute('src', `/api/assets/${KEY}`);
    act(() => {
      markImageFailed(doc, id!); // ignored: already ready
    });
    expect(el()).toHaveAttribute('data-status', 'ready');
  });
});
