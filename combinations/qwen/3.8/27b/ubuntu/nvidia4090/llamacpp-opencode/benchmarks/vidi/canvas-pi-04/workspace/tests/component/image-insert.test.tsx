// Story 12, component tests (TC-17..TC-24, TC-29).
//
// The full App is rendered against a mocked connector (reports a chosen
// connection state, seeds optional images into a real Y.Doc) plus a mocked
// image-size reader and a deferred XHR upload mock (so progress and the
// result are controlled per test). Pointer/clipboard events are dispatched on
// the right surface; the drop handlers live on `.app-root`.

import { act, cleanup, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { newBoardId } from '../../src/shared/board-id';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import { getIdentityId } from '../../src/client/identity';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { resetBoardForTests, setBoardCamera } from '../../src/client/canvas/useCamera';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import type { UploadResult } from '../../src/client/images/uploadImage';

const REJECTION_OFFLINE = REJECTION_MESSAGES.offline;
const REJECTION_RATE = REJECTION_MESSAGES.rate;
const REJECTION_TYPE = REJECTION_MESSAGES.type;

// Deterministic camera: world (0,0) at screen (512,384), zoom 1.
const CAM = { x: -512, y: -384, zoom: 1 };
const KEY_A = 'aaaaaaaaaaaaaaaaaaaaaa/bbbbbbbbbbbbbbbbbbbbbb';

// Module-scope mock state, read by the hoisted mocks.
const MOCK = vi.hoisted(() => ({
  state: 'connected' as ConnectionState,
  doc: null as Y.Doc | null,
  readSizeImpl: (() => Promise.resolve({ width: 640, height: 480 })) as (file: File) => Promise<{ width: number; height: number }>,
  uploads: [] as Array<{ resolve: (r: UploadResult) => void; onProgress: (f: number) => void; file: File; boardId: string }>,
  // Optional images to seed into a fresh doc (raw fields).
  seed: [] as Array<{
    id?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    status: 'uploading' | 'ready' | 'failed';
    assetKey: string | null;
    uploaderId: string;
    uploadStartedAt: number;
  }>,
}));

vi.mock('../../src/client/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/api')>();
  return { ...actual, checkBoard: vi.fn().mockResolvedValue({ kind: 'exists' }) };
});

vi.mock('../../src/client/sync/connectBoard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/client/sync/connectBoard')>();
  return {
    ...actual,
    connectBoard: (doc: Y.Doc, _boardId: string, onState: (s: ConnectionState) => void) => {
      onState(MOCK.state);
      MOCK.doc = doc;
      if (MOCK.seed.length > 0) {
        queueMicrotask(() => seedImagesIntoDoc(doc, MOCK.seed));
      }
      return { destroy: (): void => undefined };
    },
  };
});

vi.mock('../../src/client/images/readImageSize', () => ({
  readImageSize: (file: File): Promise<{ width: number; height: number }> => MOCK.readSizeImpl(file),
}));

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (boardId: string, file: File, onProgress: (f: number) => void) => {
    let resolveFn!: (r: UploadResult) => void;
    const promise = new Promise<UploadResult>((res) => {
      resolveFn = res;
    });
    MOCK.uploads.push({ resolve: resolveFn, onProgress, file, boardId });
    return { promise, abort: vi.fn() };
  },
}));

// --- helpers --------------------------------------------------------------

// Raw doc write (bypasses the model helpers) so a seed can carry any status.
function seedImagesIntoDoc(doc: Y.Doc, seed: typeof MOCK.seed): void {
  const objects = doc.getMap<Y.Map<unknown>>('objects');
  for (const spec of seed) {
    const id = spec.id ?? `id${objects.size.toString().padStart(4, '0')}`;
    const m = new Y.Map<unknown>();
    m.set('type', 'image');
    m.set('x', spec.x);
    m.set('y', spec.y);
    m.set('width', spec.width);
    m.set('height', spec.height);
    m.set('z', 1);
    m.set('assetKey', spec.assetKey);
    m.set('contentType', 'image/png');
    m.set('naturalWidth', 640);
    m.set('naturalHeight', 480);
    m.set('status', spec.status);
    m.set('uploadStartedAt', spec.uploadStartedAt);
    m.set('uploaderId', spec.uploaderId);
    objects.set(id, m);
  }
}

function renderApp(): void {
  // Route to a fresh board (useRoute reads location.pathname).
  window.history.pushState({}, '', `/b/${newBoardId()}`);
  act(() => {
    setBoardCamera(CAM);
  });
  render(<App />);
}

function makeFile(name: string, type: string): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type });
}

function dropFiles(files: File[], at = { x: 200, y: 150 }): void {
  const root = document.querySelector('.app-root');
  if (root === null) throw new Error('.app-root not found');
  const e = new Event('drop', { bubbles: true, cancelable: true });
  Object.assign(e, {
    dataTransfer: { types: ['Files'], files },
    clientX: at.x,
    clientY: at.y,
  });
  act(() => {
    root.dispatchEvent(e);
  });
}

// Flush microtasks so the async insert flow (readImageSize → placeholders →
// upload) and the Y.Doc → store → render pipeline settle.
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function images(): HTMLElement[] {
  return screen.getAllByTestId('image-object');
}

beforeEach(() => {
  resetBoardForTests();
  MOCK.state = 'connected';
  MOCK.doc = null;
  MOCK.uploads.length = 0;
  MOCK.seed.length = 0;
  MOCK.readSizeImpl = () => Promise.resolve({ width: 640, height: 480 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('story 12: image insertion (component)', () => {
  it('TC-17: dropping three files places three images with progress, then ready', async () => {
    renderApp();
    await settle();

    dropFiles([makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png'), makeFile('c.png', 'image/png')]);
    await settle();

    // Three placeholders, all uploading; three uploads started.
    expect(images()).toHaveLength(3);
    expect(images().every((el) => el.getAttribute('data-status') === 'uploading')).toBe(true);
    expect(MOCK.uploads).toHaveLength(3);

    // Progress: emit 50% for the first upload → the bar text updates.
    act(() => {
      MOCK.uploads[0]!.onProgress(0.5);
    });
    expect(screen.getAllByTestId('image-progress-text')[0]!.textContent).toBe('50%');

    // Complete the first upload as ok → ready with a served <img>.
    await act(async () => {
      MOCK.uploads[0]!.resolve({ kind: 'ok', assetKey: KEY_A });
    });
    await settle();

    const first = images()[0]!;
    expect(first.getAttribute('data-status')).toBe('ready');
    expect(first.querySelector('img')?.getAttribute('src')).toBe(`/api/assets/${KEY_A}`);
    // The other two are still uploading.
    expect(images().filter((el) => el.getAttribute('data-status') === 'uploading')).toHaveLength(2);
  });

  it('TC-19: dropping while offline shows the offline toast and adds nothing', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    renderApp();
    await settle();

    dropFiles([makeFile('a.png', 'image/png')]);
    await settle();

    expect(screen.getByTestId('toast').textContent).toBe(REJECTION_OFFLINE);
    expect(screen.queryAllByTestId('image-object')).toHaveLength(0);
    expect(MOCK.uploads).toHaveLength(0);
  });

  it('TC-20: a rate-limited upload fails the image and shows the rate toast', async () => {
    renderApp();
    await settle();

    dropFiles([makeFile('a.png', 'image/png')]);
    await settle();

    await act(async () => {
      MOCK.uploads[0]!.resolve({ kind: 'rate_limited' });
    });
    await settle();

    expect(images()[0]!.getAttribute('data-status')).toBe('failed');
    expect(screen.getByTestId('toast').textContent).toBe(REJECTION_RATE);
    // The file stays in memory → Retry is offered to the uploader.
    expect(screen.getByTestId('image-retry')).toBeDefined();
  });

  it('TC-18: pasting image files inserts them at the view centre', async () => {
    renderApp();
    await settle();

    const file = makeFile('paste.png', 'image/png');
    const items = [{ kind: 'file', type: 'image/png', getAsFile: () => file }];
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(e, { clipboardData: { items } });
    act(() => {
      window.dispatchEvent(e);
    });
    await settle();

    expect(images()).toHaveLength(1);
    expect(images()[0]!.getAttribute('data-status')).toBe('uploading');
    expect(MOCK.uploads).toHaveLength(1);
  });

  it('TC-23: an img load error renders the "Image unavailable" box at the same size', async () => {
    MOCK.seed.push({
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      status: 'ready',
      assetKey: KEY_A,
      uploaderId: getIdentityId(),
      uploadStartedAt: Date.now(),
    });
    renderApp();
    await settle();

    const img = screen.getByTestId('image-img');
    expect(img.getAttribute('src')).toBe(`/api/assets/${KEY_A}`);
    act(() => {
      img.dispatchEvent(new Event('error'));
    });
    await settle();

    const box = screen.getByTestId('image-unavailable');
    expect(box.textContent).toBe('Image unavailable');
    // The box keeps the object's exact box.
    const el = images()[0]!;
    expect(el.style.width).toBe('200px');
    expect(el.style.height).toBe('150px');
  });

  it('TC-29: a file that fails to decode is rejected (no placeholder)', async () => {
    // readImageSize throws for this file (decode failure).
    MOCK.readSizeImpl = () => Promise.reject(new Error('decode'));
    renderApp();
    await settle();

    dropFiles([makeFile('corrupt.png', 'image/png')]);
    await settle();

    expect(screen.getByTestId('toast').textContent).toBe(REJECTION_TYPE);
    expect(screen.queryAllByTestId('image-object')).toHaveLength(0);
    expect(MOCK.uploads).toHaveLength(0);
  });

  it('TC-22: a stale upload renders "Image upload didn\'t finish" with Remove', async () => {
    MOCK.seed.push({
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      status: 'uploading',
      assetKey: null,
      uploaderId: getIdentityId(),
      uploadStartedAt: Date.now() - IMAGE_UPLOAD_STALE_MS - 1000,
    });
    renderApp();
    await settle();

    const el = images()[0]!;
    expect(el.getAttribute('data-status')).toBe('unfinished');
    expect(screen.getByTestId('image-unfinished').textContent).toContain("Image upload didn't finish");
    // Remove deletes the object.
    act(() => {
      screen.getByTestId('image-remove').click();
    });
    await settle();
    expect(screen.queryAllByTestId('image-object')).toHaveLength(0);
  });

  it('TC-21a: a failed image renders Retry + Remove to its uploader', async () => {
    renderApp();
    await settle();

    dropFiles([makeFile('a.png', 'image/png')]);
    await settle();
    await act(async () => {
      MOCK.uploads[0]!.resolve({ kind: 'failed', status: 500 });
    });
    await settle();

    const el = images()[0]!;
    expect(el.getAttribute('data-status')).toBe('failed');
    // Uploader with the file in memory → Retry and Remove.
    expect(screen.getByTestId('image-retry')).toBeDefined();
    expect(screen.getByTestId('image-remove')).toBeDefined();
  });

  it('TC-21b: a failed image renders "Image unavailable" to another identity', async () => {
    MOCK.seed.push({
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      status: 'failed',
      assetKey: null,
      uploaderId: 'zzzzzzzzzzzzzzzzzzzzzz', // not the local identity
      uploadStartedAt: Date.now(),
    });
    renderApp();
    await settle();

    const el = images()[0]!;
    expect(el.getAttribute('data-status')).toBe('failed');
    expect(screen.getByTestId('image-unavailable').textContent).toBe('Image unavailable');
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.queryByTestId('image-remove')).toBeNull();
  });

  it('TC-24a: Retry re-uploads (file still in memory) and the object goes back to uploading', async () => {
    renderApp();
    await settle();

    dropFiles([makeFile('a.png', 'image/png')]);
    await settle();
    await act(async () => {
      MOCK.uploads[0]!.resolve({ kind: 'failed', status: 500 });
    });
    await settle();
    expect(images()[0]!.getAttribute('data-status')).toBe('failed');

    // Retry → a second upload is started and the object is uploading again.
    act(() => {
      screen.getByTestId('image-retry').click();
    });
    await settle();
    expect(MOCK.uploads).toHaveLength(2);
    expect(images()[0]!.getAttribute('data-status')).toBe('uploading');
  });

  it('TC-24b: after a simulated reload the failed image offers only Remove', async () => {
    // A failed image whose uploader is the local identity, but the in-memory
    // file map is empty (fresh render) → canRetry is false → Remove only.
    MOCK.seed.push({
      x: 100,
      y: 100,
      width: 200,
      height: 150,
      status: 'failed',
      assetKey: null,
      uploaderId: getIdentityId(),
      uploadStartedAt: Date.now(),
    });
    renderApp();
    await settle();

    expect(images()[0]!.getAttribute('data-status')).toBe('failed');
    expect(screen.queryByTestId('image-retry')).toBeNull();
    expect(screen.getByTestId('image-remove')).toBeDefined();
  });
});
