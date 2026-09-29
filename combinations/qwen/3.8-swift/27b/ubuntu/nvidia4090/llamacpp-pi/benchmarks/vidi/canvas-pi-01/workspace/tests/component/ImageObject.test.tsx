// ImageObject component tests (spec: image.states, TC-21 to TC-24).
//
// Full app at the 1280x800 fixture, HOME camera. Objects are created through
// the real insert flow (drop), so the in-memory File map (Retry) is
// populated; doc fields are then driven to each state. "Other participant"
// views are simulated by overwriting the object's uploaderId.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { act } from '@testing-library/react';
import type * as Y from 'yjs';

import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { createImagePlaceholders, markImageFailed } from '../../src/shared/objects/image';
import { measureImage } from '../../src/client/images/measureImage';
import { uploadImage, type UploadResult } from '../../src/client/images/uploadImage';
import { click, installResizeObserverMock, renderApp, viewportEl } from './helpers';
import { boardDoc, liveNotes } from './story7-helpers';

const mockedMeasure = vi.mocked(measureImage);
const mockedUpload = vi.mocked(uploadImage);

vi.mock('../../src/client/images/measureImage', () => ({
  measureImage: vi.fn(),
}));
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn(),
}));

const pending: { resolve(result: UploadResult): void }[] = [];

function file(name = 'a.png'): File {
  return new File([new Uint8Array(100)], name, { type: 'image/png' });
}

function connect(): void {
  const hook = window.__vidi6;
  if (hook === undefined) throw new Error('test hook missing');
  act(() => {
    hook.setConnectionState('connected');
  });
}

function dropFile(): void {
  const el = viewportEl(document.body);
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: { files: [file()], types: ['Files'] } });
  Object.defineProperty(event, 'clientX', { value: 400 });
  Object.defineProperty(event, 'clientY', { value: 300 });
  act(() => {
    el.dispatchEvent(event);
  });
}

async function flush(): Promise<void> {
  await act(async () => {});
}

/** The single image object in the doc. */
function theImageId(): string {
  const images = liveNotes().filter((n) => n.type === 'image');
  expect(images).toHaveLength(1);
  return images[0]!.id;
}

function objectMap(id: string): Y.Map<unknown> {
  const map = boardDoc().getMap('objects').get(id);
  if (map === undefined) throw new Error(`object ${id} not in doc`);
  return map as unknown as Y.Map<unknown>;
}

function imgEl(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="image-object"]');
}

function byTestid(testid: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
}

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
  pending.length = 0;
  mockedMeasure.mockReset();
  mockedUpload.mockReset();
  mockedMeasure.mockResolvedValue({ width: 100, height: 50, contentType: 'image/png' });
  mockedUpload.mockImplementation((_b, _f, _p) => {
    let resolver: (r: UploadResult) => void = () => {};
    const promise = new Promise<UploadResult>((resolve) => {
      resolver = resolve;
    });
    pending.push({ resolve: (r) => resolver(r) });
    return { promise, abort: vi.fn() };
  });
});

afterEach(() => cleanup());

describe('ImageObject states (image.states)', () => {
  it('TC-21: failed upload shows "Upload failed" + Retry + Remove for the uploader, "Image unavailable" for a peer', async () => {
    await renderApp();
    connect();
    dropFile();
    await flush();
    pending[0]!.resolve({ kind: 'failed', status: 500 });
    await flush();

    const el = imgEl();
    expect(el).not.toBeNull();
    expect(el!.dataset.status).toBe('failed');
    expect(byTestid('image-error-label')!.textContent).toBe('Upload failed');
    expect(byTestid('image-retry')).not.toBeNull();
    expect(byTestid('image-remove')).not.toBeNull();
    expect(document.querySelector('[data-testid="image-img"]')).toBeNull();

    // Same object viewed by a peer (uploaderId is someone else's):
    // no actions, the unavailable box.
    const id = theImageId();
    act(() => {
      objectMap(id).set('uploaderId', 'peeridentity123456');
    });
    await flush();
    expect(byTestid('image-error-label')!.textContent).toBe('Image unavailable');
    expect(byTestid('image-retry')).toBeNull();
    expect(byTestid('image-remove')).toBeNull();
  });

  it("TC-22: an uploading object older than 6 minutes shows \"Image upload didn't finish\" + Remove", async () => {
    await renderApp();
    connect();
    dropFile();
    await flush();
    const id = theImageId();
    act(() => {
      objectMap(id).set('uploadStartedAt', Date.now() - IMAGE_UPLOAD_STALE_MS - 60_000);
    });
    await flush();

    expect(imgEl()!.dataset.status).toBe('unfinished');
    expect(byTestid('image-error-label')!.textContent).toBe("Image upload didn't finish");
    expect(byTestid('image-remove')).not.toBeNull();
    expect(byTestid('image-retry')).toBeNull();

    // Remove deletes the object from the doc.
    click(byTestid('image-remove')!);
    await flush();
    expect(liveNotes().filter((n) => n.type === 'image')).toHaveLength(0);
  });

  it('TC-23: a ready image whose <img> fails to load shows the unavailable box at the same size', async () => {
    await renderApp();
    connect();
    dropFile();
    await flush();
    const id = theImageId();
    const obj = objectMap(id);
    const width = obj.get('width') as number;
    const height = obj.get('height') as number;
    pending[0]!.resolve({ kind: 'ok', assetKey: 'board/asset1234567890ab', contentType: 'image/png' });
    await flush();

    const img = byTestid('image-img');
    expect(img).not.toBeNull();
    act(() => {
      img!.dispatchEvent(new Event('error'));
    });
    await flush();
    expect(imgEl()!.dataset.status).toBe('unavailable');
    const box = byTestid('image-unavailable');
    expect(box).not.toBeNull();
    expect(byTestid('image-error-label')!.textContent).toBe('Image unavailable');
    // Same footprint as the image (the box fills the object's size).
    const wrapper = imgEl()!;
    expect(wrapper.style.width).toBe(`${width}px`);
    expect(wrapper.style.height).toBe(`${height}px`);
    expect(box).not.toBeNull();
  });

  it('TC-24: Retry re-uploads the in-memory file; after a reload only Remove remains', async () => {
    await renderApp();
    connect();
    dropFile();
    await flush();
    pending[0]!.resolve({ kind: 'failed', status: 500 });
    await flush();
    expect(imgEl()!.dataset.status).toBe('failed');

    // Retry: the same file goes up again, status back to uploading.
    click(byTestid('image-retry')!);
    await flush();
    expect(mockedUpload).toHaveBeenCalledTimes(2);
    expect(imgEl()!.dataset.status).toBe('uploading');
    pending[1]!.resolve({ kind: 'ok', assetKey: 'board/asset1234567890ab', contentType: 'image/png' });
    await flush();
    expect(imgEl()!.dataset.status).toBe('ready');

    // Simulated reload: a fresh app re-syncs the (failed) object from the
    // server but has no in-memory files, so it shows Remove only (no Retry).
    cleanup();
    pending.length = 0;
    await renderApp();
    const doc = boardDoc();
    let ids: string[] = [];
    await act(async () => {
      ids = createImagePlaceholders(
        doc,
        [{ rect: { x: 0, y: 0, width: 100, height: 50 }, naturalWidth: 100, naturalHeight: 50, contentType: 'image/png' }],
        `c${doc.clientID}`,
        Date.now(),
      );
    });
    const reloadedId = ids[0];
    if (reloadedId === undefined) throw new Error('no reloaded object');
    act(() => {
      markImageFailed(doc, reloadedId);
    });
    await flush();
    expect(byTestid('image-retry')).toBeNull();
    expect(byTestid('image-remove')).not.toBeNull();
    expect(byTestid('image-error-label')!.textContent).toBe('Upload failed');
  });
});
