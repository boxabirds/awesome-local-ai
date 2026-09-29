// Story 12 (image.render / image.aspect_resize / image.unavailable /
// image.drop) component tests: TC-17 to TC-20.
//
// The y-websocket provider is replaced with a fake (as in the story 7-11
// tests) so every test deterministically reaches connected + synced
// (editable). jsdom has no layout: the viewport is 0×0, the camera resets
// to {0,0,1}, so world == screen coordinates and only objects within the
// sticky-size margin of the origin render (objects are placed there).
// Images are created through the production model API
// (createImagePlaceholders + status updates), exactly as the insertion
// hook does; the paste test drives the REAL insertion flow with stubbed
// Image / URL.createObjectURL / fetch.

import { act, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { renderAppAt } from './render-app';
import {
  createImagePlaceholders,
  imageSnapshot,
  markImageFailed,
  markImageReady,
} from '../../src/shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';

/** Fake provider: records the doc and lets tests emit the events the
 *  connection tracker listens for. */
interface FakeProvider {
  doc: Y.Doc;
  open(): void;
  doSync(): void;
}

vi.mock('y-websocket', () => {
  class FakeWebsocketProvider {
    static instances: FakeProvider[] = [];
    doc: Y.Doc;
    private listeners: Record<string, Array<(arg: unknown) => void>> = {};
    constructor(_url: string, _room: string, doc: Y.Doc, _opts: unknown) {
      this.doc = doc;
      FakeWebsocketProvider.instances.push(this);
    }
    on(ev: string, fn: (arg: unknown) => void): void {
      (this.listeners[ev] ??= []).push(fn);
    }
    off(ev: string, fn: (arg: unknown) => void): void {
      this.listeners[ev] = this.listeners[ev]?.filter((f) => f !== fn);
    }
    destroy(): void {
      this.listeners = {};
    }
    private emit(ev: string, arg: unknown): void {
      this.listeners[ev]?.slice().forEach((f) => f(arg));
    }
    open(): void {
      this.emit('status', { status: 'connected' });
    }
    doSync(): void {
      this.emit('sync', true);
    }
  }
  return { WebsocketProvider: FakeWebsocketProvider };
});

const fakeProviders = (): FakeProvider[] =>
  (WebsocketProvider as unknown as { instances: FakeProvider[] }).instances;

function fire(target: EventTarget, e: Event): void {
  act(() => {
    target.dispatchEvent(e);
  });
}

function pointerEvent(type: string, x: number, y: number, extra: Record<string, unknown> = {}): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { clientX: x, clientY: y, pointerId: 1, isPrimary: true, ...extra });
  return e;
}

function key(type: string, props: Record<string, unknown> = {}): Event {
  return new KeyboardEvent(type, { bubbles: true, cancelable: true, ...props });
}

function windowKey(e: Event): boolean {
  act(() => {
    window.dispatchEvent(e);
  });
  return e.defaultPrevented;
}

async function setupApp(): Promise<Y.Doc> {
  await renderAppAt();
  const all = fakeProviders();
  expect(all.length).toBeGreaterThan(0);
  const provider = all[all.length - 1];
  act(() => provider.open());
  act(() => provider.doSync());
  return provider.doc;
}

/** jsdom stubs so the real insertion flow can read natural sizes. */
function stubImageReading(width: number, height: number): void {
  class FakeImage {
    naturalWidth = 0;
    naturalHeight = 0;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      queueMicrotask(() => {
        this.naturalWidth = width;
        this.naturalHeight = height;
        this.onload?.();
      });
    }
  }
  vi.stubGlobal('Image', FakeImage);
  URL.createObjectURL = () => 'blob:fake';
  URL.revokeObjectURL = () => {};
}

interface ImageItem {
  rect: { x: number; y: number; width: number; height: number };
  naturalWidth: number;
  naturalHeight: number;
  contentType?: string;
  uploaderId?: string;
  now?: number;
}

/** Creates one image placeholder on the live doc (production model API). */
function addImage(doc: Y.Doc, item: ImageItem): string {
  const id = createImagePlaceholders(
    doc,
    [
      {
        rect: item.rect,
        naturalWidth: item.naturalWidth,
        naturalHeight: item.naturalHeight,
        contentType: item.contentType ?? 'image/png',
      },
    ],
    item.uploaderId ?? window.__vidi6!.clientId,
    item.now ?? Date.now(),
  )[0];
  expect(id).not.toBe('');
  return id;
}

const imageEl = (id: string): HTMLElement => {
  const el = document.querySelector(`[data-testid="image-object"][data-id="${id}"]`);
  expect(el).not.toBeNull();
  return el as HTMLElement;
};

async function flushMicrotasks(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('story 12: image objects', () => {
  it('TC-17: ready → <img> at the asset URL; uploading → "Uploading…"; stale → "Upload in progress"; failed → "Image unavailable"', async () => {
    const doc = await setupApp();

    let readyId = '';
    let uploadingId = '';
    let staleId = '';
    let failedId = '';
    act(() => {
      readyId = addImage(doc, {
        rect: { x: 0, y: 0, width: 100, height: 80 },
        naturalWidth: 1000,
        naturalHeight: 800,
      });
      markImageReady(doc, readyId, 'b/asset-1');

      uploadingId = addImage(doc, {
        rect: { x: 40, y: 100, width: 100, height: 80 },
        naturalWidth: 1000,
        naturalHeight: 800,
      });

      staleId = addImage(doc, {
        rect: { x: 80, y: 0, width: 100, height: 80 },
        naturalWidth: 1000,
        naturalHeight: 800,
        now: Date.now() - IMAGE_UPLOAD_STALE_MS - 1000,
      });

      failedId = addImage(doc, {
        rect: { x: 120, y: 100, width: 100, height: 80 },
        naturalWidth: 1000,
        naturalHeight: 800,
      });
      markImageFailed(doc, failedId);
    });

    // ready: the <img> with the asset URL as src.
    const img = document.querySelector<HTMLImageElement>(
      `[data-id="${readyId}"] img`,
    );
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('/api/assets/b/asset-1');
    expect(imageEl(readyId).dataset.status).toBe('ready');

    // uploading (fresh): the spinner box with "Uploading…".
    expect(imageEl(uploadingId).dataset.status).toBe('uploading');
    expect(imageEl(uploadingId).textContent).toContain('Uploading…');

    // stale upload: derived "unfinished" → "Upload in progress".
    expect(imageEl(staleId).dataset.status).toBe('unfinished');
    expect(imageEl(staleId).textContent).toContain('Upload in progress');

    // failed: "Image unavailable".
    expect(imageEl(failedId).dataset.status).toBe('failed');
    expect(imageEl(failedId).textContent).toContain('Image unavailable');
  });

  it('TC-18: a selected image resizes aspect-locked (corner drag scales both dims); the natural size is untouched', async () => {
    const doc = await setupApp();

    let id = '';
    act(() => {
      id = addImage(doc, {
        rect: { x: 10, y: 10, width: 100, height: 80 },
        naturalWidth: 1280,
        naturalHeight: 1024,
      });
      markImageReady(doc, id, 'b/asset-2');
    });

    // Click the image to select it.
    const el = imageEl(id);
    fire(el, pointerEvent('pointerdown', 60, 50));
    fire(window, pointerEvent('pointerup', 60, 50));
    expect(screen.getByTestId('selection-box')).toBeDefined();
    const handle = screen.getByRole('button', { name: 'Resize bottom-right' });

    // Drag the corner by (10, 8): both axes request ×1.1 (110/100, 88/80),
    // so the locked result is 110×88 — ratio 1.25 preserved.
    fire(handle, pointerEvent('pointerdown', 110, 90));
    fire(window, pointerEvent('pointermove', 120, 98));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });
    fire(window, pointerEvent('pointerup', 120, 98));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(16);
    });

    const snap = imageSnapshot(doc, id);
    expect(snap).not.toBeNull();
    const width = snap!.width ?? 0;
    const height = snap!.height ?? 0;
    expect(width).toBeCloseTo(110, 6);
    expect(height).toBeCloseTo(88, 6);
    // The ratio is preserved (100:80 = 110:88).
    expect(width / height).toBeCloseTo(100 / 80, 6);
    // The stored natural size is the resize reference and never changes.
    expect(snap!.naturalWidth).toBe(1280);
    expect(snap!.naturalHeight).toBe(1024);
  });

  it('TC-19: a paste whose upload 415s shows Retry/Remove; Remove deletes (one undo step); Retry re-uploads to ready', async () => {
    const doc = await setupApp();
    stubImageReading(400, 300);
    void doc;

    // The asset API 415s on the first upload, then succeeds.
    let uploads = 0;
    vi.stubGlobal(
      'fetch',
      (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (typeof url === 'string' && url.endsWith('/assets') && init?.method === 'POST') {
          uploads += 1;
          if (uploads === 1) {
            return Promise.resolve(
              new Response(JSON.stringify({ error: 'unsupported_type' }), {
                status: 415,
                headers: { 'Content-Type': 'application/json' },
              }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ assetKey: 'b/asset-3', contentType: 'image/png' }), {
              status: 201,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }
        return Promise.reject(new Error(`mock fetch: unhandled ${url}`));
      },
    );

    // Paste one PNG: the real flow (validate → natural size → placeholder →
    // upload → 415 → failed).
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(paste, { clipboardData: { files: [file] } });
    fire(window, paste);
    await flushMicrotasks();

    const el = document.querySelector<HTMLElement>('[data-testid="image-object"]');
    expect(el).not.toBeNull();
    const id = el!.dataset.id!;
    expect(el!.dataset.status).toBe('failed');
    expect(el!.textContent).toContain('Image unavailable');

    // Remove: the object is deleted, and one Ctrl+Z brings it back.
    act(() => {
      screen.getByTestId('image-remove').click();
    });
    expect(document.querySelector(`[data-id="${id}"]`)).toBeNull();
    windowKey(key('keydown', { key: 'z', ctrlKey: true }));
    expect(document.querySelector(`[data-id="${id}"]`)).not.toBeNull();

    // Retry: the upload now succeeds → the ready <img>.
    act(() => {
      screen.getByTestId('image-retry').click();
    });
    await flushMicrotasks();
    const readyImg = document.querySelector<HTMLImageElement>(`[data-id="${id}"] img`);
    expect(readyImg).not.toBeNull();
    expect(readyImg!.getAttribute('src')).toBe('/api/assets/b/asset-3');
    expect(uploads).toBe(2);
  });

  it('TC-20: dragging files over the board shows the drop highlight; leaving removes it', async () => {
    await setupApp();
    const root = document.querySelector('.board-root') as HTMLElement;
    expect(root).not.toBeNull();

    const dragEvent = (type: string): Event => {
      const e = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(e, {
        dataTransfer: {
          types: ['Files'],
          files: [new File(['x'], 'a.png', { type: 'image/png' })],
          dropEffect: '',
        },
      });
      return e;
    };

    expect(screen.queryByTestId('drop-highlight')).toBeNull();
    fire(root, dragEvent('dragenter'));
    fire(root, dragEvent('dragover'));
    expect(screen.getByTestId('drop-highlight')).not.toBeNull();
    expect(screen.getByTestId('drop-highlight').textContent).toContain('Drop images here');

    fire(root, dragEvent('dragleave'));
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });
});
