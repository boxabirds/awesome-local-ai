import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { act } from 'react';
import * as Y from 'yjs';
import { renderFullApp, hooks } from './story2';
import { REJECTION_MESSAGES } from '@/client/images/validateFiles';
import { IMAGE_UPLOAD_STALE_MS } from '@/shared/config';
import { layoutRow, placementSize } from '@/shared/objects/image';

/**
 * Story 12 component tests (TC-17..TC-24, TC-29): the image insert flows
 * (drop / paste / picker / retry) and the ImageObject render states.
 *
 * The y-websocket provider is a fake (driven to 'connected' where the flow
 * must pass the offline gate), the asset upload and the image decode are
 * mocked, and image objects are seeded straight into the shared doc for the
 * render-state cases. The uploader identity is read back through
 * `hooks().getUploaderId()` so a seeded image can be marked "mine".
 */

// --- y-websocket fake (same shape as the story-4 close-code tests). ---
const { providerHolder, mockCtl } = vi.hoisted(() => {
  type Entry = {
    onProgress?: (f: number) => void;
    resolve: (r: unknown) => void;
    aborted: boolean;
  };
  return {
    providerHolder: { current: null as unknown },
    mockCtl: {
      calls: [] as Entry[],
      bmp: { width: 200, height: 100, reject: new Set<string>() },
    },
  };
});

vi.mock('y-websocket', () => {
  class FakeProvider {
    private ls: Record<string, Array<(...a: unknown[]) => void>> = {};
    _synced = false;
    constructor(
      public url: string,
      public room: string,
      public doc: unknown,
      public opts: unknown,
    ) {
      providerHolder.current = this;
    }
    on(evt: string, cb: (...a: unknown[]) => void): void {
      (this.ls[evt] ??= []).push(cb);
    }
    off(evt: string, cb: (...a: unknown[]) => void): void {
      this.ls[evt] = (this.ls[evt] ?? []).filter((f) => f !== cb);
    }
    emit(evt: string, ...args: unknown[]): void {
      for (const cb of this.ls[evt] ?? []) cb(...args);
    }
    get synced(): boolean {
      return this._synced;
    }
    destroy(): void {}
    disconnect(): void {}
    connect(): void {}
  }
  return { WebsocketProvider: FakeProvider };
});

// Story 5: the board page checks existence before mounting; pretend it exists.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

// The asset upload: controllable per-call (progress + resolution).
vi.mock('@/client/images/uploadImage', () => ({
  uploadImage: vi.fn((_boardId: string, _file: File, onProgress?: (f: number) => void) => {
    let resolveFn: (r: unknown) => void = () => undefined;
    const entry: (typeof mockCtl.calls)[number] = {
      onProgress,
      resolve: (r: unknown) => resolveFn(r),
      aborted: false,
    };
    const promise = new Promise((res) => {
      resolveFn = res;
    });
    mockCtl.calls.push(entry);
    return { promise, abort: () => { entry.aborted = true; } };
  }),
  // Board registers this as the fail-next-upload test hook (no-op in tests;
  // uploads are driven by the mock above).
  setNextUploadFail: vi.fn(),
}));

interface FakeProviderHandle {
  _synced: boolean;
  emit(evt: string, ...args: unknown[]): void;
}

function provider(): FakeProviderHandle {
  const p = providerHolder.current as FakeProviderHandle | null;
  if (!p) throw new Error('y-websocket provider not created');
  return p;
}

/** Drives the board connection to 'connected' (passes the offline gate). */
function connect(): void {
  const p = provider();
  act(() => {
    p._synced = true;
    p.emit('status', { status: 'connected' });
  });
}

function makeFile(name: string, type = 'image/png'): File {
  return new File([new Uint8Array([137, 80, 78, 71, 13, 10])], name, { type });
}

/** Dispatches a native file drag-drop onto the board viewport. */
function dropFiles(files: File[], clientX: number, clientY: number): void {
  const el = document.querySelector('[data-testid="board-viewport"]');
  if (!el) throw new Error('viewport not found');
  const evt = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'dataTransfer', { value: { files, types: ['Files'] } });
  Object.defineProperty(evt, 'clientX', { value: clientX });
  Object.defineProperty(evt, 'clientY', { value: clientY });
  act(() => {
    el.dispatchEvent(evt);
  });
}

/** Dispatches a native paste (clipboardData.files) onto a target (bubbles to document). */
function pasteFiles(files: File[], target: Element): void {
  const evt = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(evt, 'clipboardData', { value: { files, items: [] } });
  act(() => {
    target.dispatchEvent(evt);
  });
}

function images(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="image"]'));
}

/** Seeds an image object directly into the shared doc (render-state cases). */
function seedImage(fields: Record<string, unknown>): string {
  const doc = hooks().getDoc();
  const id = crypto.randomUUID();
  const defaults: Record<string, unknown> = {
    type: 'image',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    assetKey: null,
    contentType: 'image/png',
    naturalWidth: 200,
    naturalHeight: 100,
    status: 'uploading',
    uploadStartedAt: Date.now(),
    uploaderId: 'seeded-other',
    z: 1,
    createdAt: Date.now(),
  };
  const obj = new Y.Map();
  for (const [k, v] of Object.entries({ ...defaults, ...fields })) obj.set(k, v);
  act(() => {
    doc.transact(() => {
      doc.getMap('objects').set(id, obj);
    }, 'seed');
  });
  return id;
}

beforeEach(() => {
  mockCtl.calls.length = 0;
  mockCtl.bmp.width = 200;
  mockCtl.bmp.height = 100;
  mockCtl.bmp.reject.clear();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: File) => {
      if (mockCtl.bmp.reject.has(file.name)) throw new Error('decode failed');
      return { width: mockCtl.bmp.width, height: mockCtl.bmp.height, close: () => undefined };
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Story 12 — image insert flows', () => {
  it('TC-17: drop 3 valid files → 3 placeholders in a row; progress text; ready after resolve', async () => {
    await renderFullApp();
    await act(async () => {
      hooks().setCamera({ x: 0, y: 0, zoom: 1 });
    });
    connect();

    dropFiles([makeFile('a.png'), makeFile('b.png'), makeFile('c.png')], 100, 100);

    await waitFor(() => expect(mockCtl.calls.length).toBe(3));
    const els = images();
    expect(els).toHaveLength(3);
    expect(els.every((el) => el.dataset.status === 'uploading')).toBe(true);
    // a horizontal row from the drop point (camera is the identity): the three
    // boxes sit on the computed row (same top, x positions from layoutRow).
    const size = placementSize(200, 100);
    const rects = layoutRow([size, size, size], { x: 100, y: 100 }, 'top-left');
    const expectedXs = rects.map((r) => r.x).sort((a, b) => a - b);
    const expectedTop = rects[0].y;
    const lefts = els.map((el) => parseFloat(el.style.left)).sort((a, b) => a - b);
    const tops = new Set(els.map((el) => parseFloat(el.style.top)));
    expect(tops.size).toBe(1);
    expect([...tops][0]).toBeCloseTo(expectedTop, 0);
    expect(lefts).toEqual(expectedXs);
    expect(Math.min(...lefts)).toBeCloseTo(100, 0); // the first box is at the drop point

    // progress updates the uploader's percentage.
    await act(async () => {
      mockCtl.calls[0].onProgress?.(0.42);
    });
    await waitFor(() => expect(images()[0].textContent).toContain('42%'));

    // resolve → all ready (the <img> mounts; no error in jsdom).
    await act(async () => {
      for (const c of mockCtl.calls) c.resolve({ kind: 'ok', assetKey: 'board/abc' });
    });
    await waitFor(() => expect(screen.getAllByTestId('image-ready')).toHaveLength(3));
    expect(images().every((el) => el.dataset.status === 'ready')).toBe(true);
  });

  it('TC-18: paste while editing text → ignored; paste on the board → centred in view', async () => {
    await renderFullApp();
    await act(async () => {
      hooks().setCamera({ x: 0, y: 0, zoom: 1 });
    });
    connect();

    // Negative: paste targeted at an editable element (a text input, as when
    // editing a sticky's text) is ignored.
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    pasteFiles([makeFile('clip.png')], ta);
    await new Promise((r) => setTimeout(r, 20));
    expect(mockCtl.calls.length).toBe(0);
    expect(images()).toHaveLength(0);
    ta.remove();

    // Positive: paste on the board centres the image in view.
    pasteFiles([makeFile('clip.png')], document.querySelector('[data-testid="board-viewport"]')!);
    await waitFor(() => expect(images()).toHaveLength(1));
    await act(async () => {
      mockCtl.calls[0].resolve({ kind: 'ok', assetKey: 'board/abc' });
    });
    const el = images()[0];
    const w = parseFloat(el.style.width);
    const h = parseFloat(el.style.height);
    const vp = { width: window.innerWidth, height: window.innerHeight };
    expect(parseFloat(el.style.left)).toBeCloseTo(vp.width / 2 - w / 2, 0);
    expect(parseFloat(el.style.top)).toBeCloseTo(vp.height / 2 - h / 2, 0);
  });

  it('TC-19: drop while not connected → offline toast, no objects, upload not called', async () => {
    await renderFullApp();
    await act(async () => {
      hooks().setCamera({ x: 0, y: 0, zoom: 1 });
    });
    // Still 'connecting' (never connected) → the offline gate applies.
    expect(hooks().connectionState).not.toBe('connected');
    expect(hooks().connectionState).not.toBe('confirmed');

    dropFiles([makeFile('a.png')], 50, 50);
    await waitFor(() => expect(screen.getByText(REJECTION_MESSAGES.offline)).toBeTruthy());
    expect(images()).toHaveLength(0);
    expect(mockCtl.calls.length).toBe(0);
  });

  it('TC-20: picker with a rate_limited upload → object failed + rate toast', async () => {
    await renderFullApp();
    connect();

    fireEvent.click(screen.getByTestId('image-button'));
    const input = document.querySelector<HTMLInputElement>('input[type="file"][multiple]');
    expect(input).not.toBeNull();
    Object.defineProperty(input, 'files', { value: [makeFile('p.png')], configurable: true });
    fireEvent.change(input!);

    await waitFor(() => expect(mockCtl.calls.length).toBe(1));
    await act(async () => {
      mockCtl.calls[0].resolve({ kind: 'rate_limited' });
    });
    await waitFor(() => expect(images()[0].dataset.status).toBe('failed'));
    await waitFor(() => expect(screen.getByText(REJECTION_MESSAGES.rate)).toBeTruthy());
  });

  it('TC-24: retry with the file in memory re-uploads; without it, only Remove shows', async () => {
    await renderFullApp();
    connect();

    // A failed upload keeps the File in memory → Retry is offered.
    dropFiles([makeFile('a.png')], 50, 50);
    await waitFor(() => expect(mockCtl.calls.length).toBe(1));
    await act(async () => {
      mockCtl.calls[0].resolve({ kind: 'error' });
    });
    let el = images()[0];
    await waitFor(() => expect(el.dataset.status).toBe('failed'));
    // Uploader branch: Retry + Remove.
    expect(screen.getByTestId('image-retry')).toBeTruthy();
    expect(screen.getByTestId('image-remove')).toBeTruthy();

    // Retry → back to uploading and a new upload starts.
    const callsBefore = mockCtl.calls.length;
    fireEvent.click(screen.getByTestId('image-retry'));
    await waitFor(() => expect(mockCtl.calls.length).toBe(callsBefore + 1));
    await waitFor(() => expect(images()[0].dataset.status).toBe('uploading'));
    // resolve the retry → ready.
    await act(async () => {
      mockCtl.calls[callsBefore].resolve({ kind: 'ok', assetKey: 'board/retry' });
    });
    await waitFor(() => expect(images()[0].dataset.status).toBe('ready'));

    // Without the file in memory (a seeded failed image), only Remove shows.
    seedImage({ status: 'failed', uploaderId: hooks().getUploaderId() });
    await waitFor(() => expect(images().length).toBe(2));
    const seeded = images().find((e) => e.dataset.id !== el.dataset.id)!;
    expect(seeded.querySelector('[data-testid="image-retry"]')).toBeNull();
    expect(seeded.querySelector('[data-testid="image-remove"]')).toBeTruthy();
  });

  it('TC-29: createImageBitmap rejects for a corrupt file → type toast, no placeholder', async () => {
    await renderFullApp();
    connect();

    mockCtl.bmp.reject.add('corrupt.png');
    dropFiles([makeFile('corrupt.png')], 50, 50);
    await waitFor(() => expect(screen.getByText(REJECTION_MESSAGES.type)).toBeTruthy());
    expect(images()).toHaveLength(0);
    expect(mockCtl.calls.length).toBe(0);
  });
});

describe('Story 12 — ImageObject render states', () => {
  it('TC-21: failed → "Upload failed" + Retry + Remove for the uploader; "Image unavailable" for another identity', async () => {
    await renderFullApp();
    const uploader = hooks().getUploaderId();

    // Seeded "mine" failed image (no File in memory → Retry hidden, Remove shown).
    const mineId = seedImage({ status: 'failed', uploaderId: uploader });
    await waitFor(() => expect(images().length).toBe(1));
    const mine = images().find((e) => e.dataset.id === mineId)!;
    expect(mine.textContent).toContain('Upload failed');
    expect(mine.querySelector('[data-testid="image-remove"]')).toBeTruthy();

    // A seeded "other" failed image → "Image unavailable" (no buttons).
    seedImage({ status: 'failed', uploaderId: 'some-other-tab' });
    await waitFor(() => expect(images().length).toBe(2));
    const other = images().find((e) => e.dataset.id !== mineId)!;
    expect(other.textContent).toContain('Image unavailable');
    expect(other.querySelector('[data-testid="image-retry"]')).toBeNull();
    expect(other.querySelector('[data-testid="image-remove"]')).toBeNull();
  });

  it('TC-22: an uploading image older than the stale window → "didn\'t finish" + Remove; Remove deletes it', async () => {
    await renderFullApp();
    const id = seedImage({
      status: 'uploading',
      uploadStartedAt: Date.now() - (IMAGE_UPLOAD_STALE_MS + 1000),
    });
    await waitFor(() => expect(images().length).toBe(1));
    const el = images().find((e) => e.dataset.id === id)!;
    expect(el.dataset.status).toBe('unfinished');
    expect(el.textContent).toContain('didn’t finish');
    const removeBtn = el.querySelector('[data-testid="image-remove"]')!;
    expect(removeBtn).toBeTruthy();

    fireEvent.click(removeBtn);
    await waitFor(() => expect(images()).toHaveLength(0));
  });

  it('TC-23: a ready image whose <img> fires error → "Image unavailable" box, same size', async () => {
    await renderFullApp();
    const id = seedImage({ status: 'ready', assetKey: 'board/dead', uploaderId: 'other' });
    await waitFor(() => expect(screen.getAllByTestId('image-ready')).toHaveLength(1));
    const el = images().find((e) => e.dataset.id === id)!;
    const before = { w: el.style.width, h: el.style.height };

    const img = el.querySelector('img')!;
    fireEvent.error(img);
    await waitFor(() => expect(el.querySelector('[data-testid="image-unavailable"]')).toBeTruthy());
    expect(el.textContent).toContain('Image unavailable');
    // the unavailable box keeps the object's size.
    expect(el.style.width).toBe(before.w);
    expect(el.style.height).toBe(before.h);
  });
});
