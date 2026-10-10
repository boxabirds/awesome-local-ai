// Story 12 TC-21 to TC-24: the ImageObject render states — failed as
// uploader (Retry + Remove, file kept in memory via a real drop flow) vs
// other participant ("Image unavailable"), the stale-upload "unfinished"
// state with working Remove, and the img load-error fallback at full size.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { WebsocketProvider } from 'y-websocket';
import { IMAGE_UPLOAD_STALE_MS } from '../../src/shared/config';
import {
  createImagePlaceholders,
  markImageFailed,
  markImageReady,
} from '../../src/shared/objects/image';
import { getIdentity } from '../../src/client/identity/identity';
import type { ImagePlacement } from '../../src/shared/objects/image';
import { App, board, flush } from './stickyHelpers';
import { dataTransferFor, imageEl, imageSnaps, installBitmapStub, makeFile } from './imageHelpers';

const uploadMock = vi.hoisted(() => {
  const calls: { file: Blob; onProgress?: (p: number) => void }[] = [];
  const pending: { resolve(v: { assetKey: string; contentType: string }): void; reject(e: Error): void }[] = [];
  let behaviour: 'ok' | 'fail' = 'fail';
  return {
    calls,
    pending,
    setBehaviour(b: 'ok' | 'fail') {
      behaviour = b;
    },
    uploadImage(_boardId: string, file: Blob, onProgress?: (p: number) => void) {
      return new Promise<{ assetKey: string; contentType: string }>((resolve, reject) => {
        calls.push({ file, onProgress });
        pending.push({
          resolve: (v) => resolve(v),
          reject: (e) => reject(behaviour === 'fail' ? e : new Error('unexpected')),
        });
      });
    },
    clear() {
      calls.length = 0;
      pending.length = 0;
    },
  };
});

vi.mock('../../src/client/images/uploadImage', () => ({ uploadImage: uploadMock.uploadImage }));

vi.mock('y-websocket', () => {
  class MockWebsocketProvider {
    static instances: MockWebsocketProvider[] = [];
    private handlers = new Map<string, Set<(arg?: unknown) => void>>();
    awareness = { setLocalState: (_state: unknown) => undefined };

    constructor(_server: string, _room: string, _doc: unknown, _opts?: unknown) {
      MockWebsocketProvider.instances.push(this);
    }
    on(event: string, cb: (arg?: unknown) => void): void {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)!.add(cb);
    }
    off(event: string, cb: (arg?: unknown) => void): void {
      this.handlers.get(event)?.delete(cb);
    }
    emit(event: string, arg?: unknown): void {
      this.handlers.get(event)?.forEach((cb) => cb(arg));
    }
    destroy(): void {
      /* no-op */
    }
  }
  return { WebsocketProvider: MockWebsocketProvider };
});

type MockProvider = { emit(event: string, arg?: unknown): void };

function lastProvider(): MockProvider {
  const instances = (WebsocketProvider as unknown as { instances: MockProvider[] }).instances;
  return instances[instances.length - 1];
}

function connect(): void {
  act(() => lastProvider().emit('sync', true));
  flush();
}

function addImage(
  overrides: Partial<Pick<ImagePlacement, 'x' | 'y' | 'width' | 'height'>> = {},
  uploaderId = getIdentity().id,
  startedAt = Date.now(),
): string {
  let id = '';
  act(() => {
    id = createImagePlaceholders(
      board().doc,
      [
        {
          x: 0,
          y: 0,
          width: 200,
          height: 100,
          contentType: 'image/png',
          naturalWidth: 200,
          naturalHeight: 100,
          ...overrides,
        },
      ],
      uploaderId,
      startedAt,
    )[0];
  });
  flush();
  return id;
}

async function dropOneFile(): Promise<string> {
  uploadMock.setBehaviour('fail');
  await act(async () => {
    const viewport = screen.getByTestId('board-viewport');
    const dataTransfer = dataTransferFor([makeFile('shot.png')]) as object;
    fireEvent.dragEnter(viewport, { dataTransfer, clientX: 100, clientY: 100 });
    fireEvent.dragOver(viewport, { dataTransfer, clientX: 100, clientY: 100 });
    fireEvent.drop(viewport, { dataTransfer, clientX: 100, clientY: 100 });
    await Promise.resolve();
    await Promise.resolve();
  });
  await act(async () => {
    uploadMock.pending[0].reject(new Error('network error'));
    await Promise.resolve();
    await Promise.resolve();
  });
  flush();
  const id = imageSnaps()[0].id;
  return id;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  uploadMock.clear();
  installBitmapStub();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('image.object (component)', () => {
  it('TC-21: failed upload shows Retry + Remove for the uploader, "Image unavailable" for others', async () => {
    render(<App />);
    connect();

    const mine = await dropOneFile();
    expect(imageEl(mine).getAttribute('data-image-status')).toBe('failed');
    const mineBox = imageEl(mine);
    expect(within(mineBox).getByTestId('image-failed').textContent).toContain('Upload failed');
    expect(within(mineBox).getByTestId('image-retry')).toBeTruthy();
    expect(within(mineBox).getByTestId('image-remove')).toBeTruthy();

    // Another participant's failed object: no controls, just "unavailable".
    const theirs = addImage({ x: 500, y: 0 }, 'someone-else');
    act(() => {
      markImageFailed(board().doc, theirs);
    });
    flush();
    const theirsBox = imageEl(theirs);
    expect(within(theirsBox).getByTestId('image-unavailable').textContent).toContain(
      'Image unavailable',
    );
    expect(within(theirsBox).queryByTestId('image-retry')).toBeNull();
  });

  it("TC-22: stale upload shows \"Image upload didn't finish\" with Remove that deletes; fresh uploads show Uploading…", () => {
    render(<App />);
    connect();

    const stale = addImage({}, 'someone-else', Date.now() - (IMAGE_UPLOAD_STALE_MS + 1000));
    const staleBox = imageEl(stale);
    expect(staleBox.getAttribute('data-image-status')).toBe('unfinished');
    expect(within(staleBox).getByTestId('image-unfinished').textContent).toContain(
      "Image upload didn't finish",
    );

    const fresh = addImage({ x: 400, y: 0 }, 'someone-else', Date.now());
    const freshBox = imageEl(fresh);
    expect(freshBox.getAttribute('data-image-status')).toBe('uploading');
    expect(within(freshBox).getByText('Uploading…')).toBeTruthy();
    expect(within(freshBox).queryByTestId('image-unfinished')).toBeNull();

    fireEvent.click(within(staleBox).getByTestId('image-remove'));
    flush();
    expect(imageSnaps().some((i) => i.id === stale)).toBe(false);
    expect(imageSnaps().some((i) => i.id === fresh)).toBe(true);
  });

  it('TC-23: an img load error swaps in the "Image unavailable" box at the same size', () => {
    render(<App />);
    connect();

    const id = addImage({}, 'someone-else');
    act(() => {
      markImageReady(board().doc, id, `${'k'.repeat(22)}/${'a'.repeat(22)}`, 'image/png');
    });
    flush();

    const box = imageEl(id);
    const img = box.querySelector('img') as HTMLImageElement;
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toBe(`/api/assets/${'k'.repeat(22)}/${'a'.repeat(22)}`);
    const widthBefore = box.style.width;
    const heightBefore = box.style.height;

    fireEvent.error(img);

    expect(within(box).getByTestId('image-unavailable').textContent).toContain('Image unavailable');
    expect(within(box).getByTestId('image-unavailable').querySelector('svg')).toBeTruthy();
    expect(box.querySelector('img')).toBeNull();
    expect(box.style.width).toBe(widthBefore);
    expect(box.style.height).toBe(heightBefore);
  });

  it('TC-24: Retry re-uploads the kept file; after a reload (no file) only Remove remains', async () => {
    render(<App />);
    connect();

    const mine = await dropOneFile();
    expect(uploadMock.calls).toHaveLength(1);

    fireEvent.click(within(imageEl(mine)).getByTestId('image-retry'));
    flush();
    expect(uploadMock.calls).toHaveLength(2);
    expect(imageEl(mine).getAttribute('data-image-status')).toBe('uploading');
    expect(imageSnaps()[0].assetKey).toBeNull();

    // Simulated reload: the same failed state but the file map is gone — the
    // object is re-created directly in the document (no in-memory File).
    uploadMock.clear();
    act(() => {
      board().doc.getMap('objects').delete(mine);
    });
    flush();
    const reloaded = addImage({ x: 0, y: 0 });
    act(() => {
      markImageFailed(board().doc, reloaded);
    });
    flush();
    const box = imageEl(reloaded);
    expect(within(box).getByTestId('image-failed')).toBeTruthy();
    expect(within(box).queryByTestId('image-retry')).toBeNull();
    expect(within(box).getByTestId('image-remove')).toBeTruthy();
  });
});
