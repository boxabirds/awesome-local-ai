// Story 12 — image.object render states: TC-21 to TC-24.
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { getObjectType } from '../../src/client/objects/registry';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { initDoc, objectsSnapshot } from '../../src/shared/board-model';
import { IMAGE_MIN_SIZE_WORLD, IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  type ImageSnap,
  createImagePlaceholders,
  isImage,
  markImageFailed,
  markImageReady,
} from '../../src/shared/objects/image';
import { flushFrame } from './helpers';
import { type FakeUpload, filesTransfer, imageFile, stubCreateImageBitmap } from './image-test-utils';

const uploads = vi.hoisted(() => [] as FakeUpload[]);
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn((boardId: string, file: File, onProgress: (f: number) => void) => {
    let resolve!: FakeUpload['resolve'];
    const promise = new Promise<Parameters<FakeUpload['resolve']>[0]>((r) => (resolve = r));
    const abort = vi.fn();
    uploads.push({ boardId, file, onProgress, resolve, abort });
    return { promise, abort };
  }),
}));

const KEY = 'AAAAAAAAAAAAAAAAAAAAAA/BBBBBBBBBBBBBBBBBBBBBB';

function newDoc() {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

const images = (doc: Y.Doc) => objectsSnapshot(doc).filter(isImage) as ImageSnap[];

function snap(overrides: Partial<ImageSnap> = {}): ImageSnap {
  return {
    id: 'img-1',
    type: 'image',
    x: 10,
    y: 20,
    width: 300,
    height: 200,
    z: 1,
    createdAt: 1000,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 300,
    naturalHeight: 200,
    status: 'uploading',
    uploadStartedAt: 1000,
    uploaderId: 'me',
    ...overrides,
  };
}

function renderObject(props: Partial<Parameters<typeof ImageObject>[0]> = {}) {
  const onRetry = vi.fn();
  const onRemove = vi.fn();
  const utils = render(
    <ImageObject image={snap()} isUploader canRetry now={1000} onRetry={onRetry} onRemove={onRemove} {...props} />,
  );
  return { ...utils, onRetry, onRemove };
}

function renderBoard(doc: Y.Doc) {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  const utils = render(<App doc={doc} />);
  act(() => window.__vidi6?.setCamera({ x: 0, y: 0, zoom: 1 }));
  flushFrame();
  return utils;
}

/** The guest id App uses for this tab (kept in sessionStorage). */
function myId(): string {
  const id = sessionStorage.getItem('vidi6-guest-id');
  if (!id) throw new Error('no guest id');
  return id;
}

beforeEach(() => {
  uploads.length = 0;
  stubCreateImageBitmap({ 'a.png': { width: 300, height: 200 } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('registry', () => {
  it('image is resizable, aspect-locked, with IMAGE_MIN_SIZE_WORLD as minimum and no editable text', () => {
    expect(getObjectType('image')).toMatchObject({
      resizable: true,
      aspectLocked: true,
      minSize: IMAGE_MIN_SIZE_WORLD,
      editableText: false,
    });
  });
});

describe('uploading', () => {
  it('uploader sees progress %, others see "Uploading…"', () => {
    const { rerender } = renderObject({ progress: 0.256 });
    expect(screen.getByText('26%')).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('26');
    rerender(<ImageObject image={snap()} isUploader={false} canRetry={false} now={1000} onRetry={() => {}} onRemove={() => {}} />);
    expect(screen.getByText('Uploading…')).toBeTruthy();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe('failed (TC-21)', () => {
  it('uploader: "Upload failed" with Retry and Remove', () => {
    const { onRetry, onRemove } = renderObject({ image: snap({ status: 'failed' }) });
    expect(screen.getByText('Upload failed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-status="failed"]')?.classList.contains('is-error')).toBe(true);
  });

  it('another identity: "Image unavailable", no buttons', () => {
    renderObject({ image: snap({ status: 'failed' }), isUploader: false });
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByText('Upload failed')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('on a board that cannot be edited the buttons are hidden', () => {
    renderObject({ image: snap({ status: 'failed' }), editable: false });
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('unfinished (TC-22)', () => {
  it('an upload older than IMAGE_UPLOAD_STALE_MS shows "Image upload didn\'t finish" + Remove to anyone; Remove deletes it', () => {
    const doc = newDoc();
    const started = Date.now() - IMAGE_UPLOAD_STALE_MS - 1;
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 50, y: 50, width: 300, height: 200 }, naturalWidth: 300, naturalHeight: 200, contentType: 'image/png' }],
      'someone-else',
      started,
    );
    renderBoard(doc);
    const el = document.querySelector(`[data-image-object][data-id="${id}"]`) as HTMLElement;
    expect(within(el).getByText("Image upload didn't finish")).toBeTruthy();
    expect(within(el).queryByText('Uploading…')).toBeNull();
    fireEvent.click(within(el).getByRole('button', { name: 'Remove' }));
    expect(images(doc)).toHaveLength(0);
    // Remove is one undo step.
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(images(doc)).toHaveLength(1);
  });

  it('a placeholder turns unfinished on its own once the stale time passes (shared clock)', () => {
    vi.useFakeTimers();
    const doc = newDoc();
    createImagePlaceholders(
      doc,
      [{ rect: { x: 50, y: 50, width: 300, height: 200 }, naturalWidth: 300, naturalHeight: 200, contentType: 'image/png' }],
      'someone-else',
      Date.now(),
    );
    render(<App doc={doc} />);
    expect(screen.getByText('Uploading…')).toBeTruthy();
    act(() => vi.advanceTimersByTime(IMAGE_UPLOAD_STALE_MS + 30_000));
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
  });

  it('the ImageObject itself switches at the boundary', () => {
    const image = snap({ uploadStartedAt: 0 });
    const { rerender } = renderObject({ image, isUploader: false, now: IMAGE_UPLOAD_STALE_MS });
    expect(screen.getByText('Uploading…')).toBeTruthy();
    rerender(<ImageObject image={image} isUploader={false} canRetry={false} now={IMAGE_UPLOAD_STALE_MS + 1} onRetry={() => {}} onRemove={() => {}} />);
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();
  });
});

describe('unavailable (TC-23)', () => {
  it('an img error shows an "Image unavailable" box of the same size; a new asset key tries again', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 50, y: 60, width: 320, height: 240 }, naturalWidth: 320, naturalHeight: 240, contentType: 'image/png' }],
      'someone-else',
      Date.now(),
    );
    markImageReady(doc, id!, KEY);
    renderBoard(doc);
    const el = document.querySelector(`[data-image-object][data-id="${id}"]`) as HTMLElement;
    const img = within(el).getByRole('img', { name: 'Image' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toBe(`/api/assets/${KEY}`);
    expect(img.getAttribute('draggable')).toBe('false');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('decoding')).toBe('async');
    fireEvent.error(img);
    expect(within(el).getByText('Image unavailable')).toBeTruthy();
    expect(within(el).queryByRole('img')).toBeNull();
    expect([el.style.left, el.style.top, el.style.width, el.style.height]).toEqual(['50px', '60px', '320px', '240px']);
    // The rest of the board still works: the image is still an object you can select.
    expect(el.getAttribute('aria-label')).toBe('Image');
    act(() => {
      markImageReady(doc, id!, 'AAAAAAAAAAAAAAAAAAAAAA/CCCCCCCCCCCCCCCCCCCCCC');
    });
    expect(within(el).getByRole('img', { name: 'Image' })).toBeTruthy();
  });
});

describe('retry (TC-24)', () => {
  it('Retry with the file in memory uploads the same file again; after a reload only Remove is offered', async () => {
    const doc = newDoc();
    const { unmount } = renderBoard(doc);
    fireEvent.drop(screen.getByTestId('board-viewport'), {
      dataTransfer: filesTransfer([imageFile('a.png')]),
      clientX: 40,
      clientY: 40,
    });
    await waitFor(() => expect(uploads).toHaveLength(1));
    const [image] = images(doc);
    expect(image!.uploaderId).toBe(myId());
    await act(async () => uploads[0]!.resolve({ kind: 'failed', status: 500 }));
    expect(images(doc)[0]!.status).toBe('failed');
    expect(screen.getByText('Upload failed')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(images(doc)[0]!.status).toBe('uploading');
    expect(uploads).toHaveLength(2);
    expect(uploads[1]!.file).toBe(uploads[0]!.file);
    expect(screen.getByText('0%')).toBeTruthy();
    await act(async () => uploads[1]!.resolve({ kind: 'failed' }));
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();

    // Simulated reload: a new board instance on the same document, same tab identity, no files in memory.
    unmount();
    renderBoard(doc);
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(images(doc)).toHaveLength(0);
  });

  it('a failed upload of someone else: Retry is never offered', () => {
    const doc = newDoc();
    const [id] = createImagePlaceholders(
      doc,
      [{ rect: { x: 0, y: 0, width: 100, height: 100 }, naturalWidth: 100, naturalHeight: 100, contentType: 'image/png' }],
      'someone-else',
      Date.now(),
    );
    markImageFailed(doc, id!);
    renderBoard(doc);
    expect(screen.getByText('Image unavailable')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });
});
