// Story 12 TC-17, TC-18, TC-19, TC-29: the drop, paste and picker flows —
// placeholders in a row with live progress, the text-editor paste guard, the
// offline refusal and the client-side decode failure. uploadImage is mocked
// (flows under test, not the network) and createImageBitmap is stubbed.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WebsocketProvider } from 'y-websocket';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import { screenToWorld } from '../../src/client/canvas/camera';
import {
  App,
  createNote,
  flush,
  noteEl,
  pressAndRelease,
  readCamera,
} from './stickyHelpers';
import {
  VIEWPORT_SIZE,
  bitmapDims,
  dataTransferFor,
  expectNear,
  imageSnaps,
  installBitmapStub,
  makeFile,
} from './imageHelpers';

const uploadMock = vi.hoisted(() => {
  type Settled = { assetKey: string; contentType: string };
  const calls: { boardId: string; file: Blob; onProgress?: (p: number) => void }[] = [];
  const pending: { resolve(v: Settled): void; reject(e: Error): void }[] = [];
  return {
    calls,
    pending,
    uploadImage(
      boardId: string,
      file: Blob,
      onProgress?: (p: number) => void,
    ): Promise<Settled> {
      return new Promise<Settled>((resolve, reject) => {
        calls.push({ boardId, file, onProgress });
        pending.push({ resolve, reject });
      });
    },
    clear(): void {
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

const OFFLINE_TOAST = "You're offline — images can be added when you reconnect.";
const TYPE_TOAST = 'Only PNG, JPEG, GIF and WebP images can be added.';

function drop(files: File[], clientX = 300, clientY = 200): void {
  const viewport = screen.getByTestId('board-viewport');
  const dataTransfer = dataTransferFor(files) as object;
  fireEvent.dragEnter(viewport, { dataTransfer, clientX, clientY });
  fireEvent.dragOver(viewport, { dataTransfer, clientX, clientY });
  fireEvent.drop(viewport, { dataTransfer, clientX, clientY });
}

function paste(files: File[]): void {
  fireEvent.paste(window, { clipboardData: { files, types: ['Files'], getData: () => '' } });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  uploadMock.clear();
  bitmapDims.clear();
  installBitmapStub();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('image.insert (component)', () => {
  it('TC-17: dropping three files creates a row of placeholders with live progress, ready after 201', async () => {
    render(<App />);
    connect();

    const files = [makeFile('a.png'), makeFile('b.png'), makeFile('c.png')];
    const viewport = screen.getByTestId('board-viewport');
    const dataTransfer = dataTransferFor(files) as object;

    act(() => {
      fireEvent.dragEnter(viewport, { dataTransfer, clientX: 300, clientY: 200 });
    });
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();

    await act(async () => {
      fireEvent.dragOver(viewport, { dataTransfer, clientX: 300, clientY: 200 });
      fireEvent.drop(viewport, { dataTransfer, clientX: 300, clientY: 200 });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByTestId('drop-highlight')).toBeNull();

    const cam = readCamera();
    const start = screenToWorld(cam, { x: 300, y: 200 });
    const imgs = [...imageSnaps()].sort((a, b) => a.x - b.x);
    expect(imgs).toHaveLength(3);
    expect(imgs.every((i) => i.status === 'uploading')).toBe(true);
    // First image's top-left at the drop point, row to the right, one gap
    // between neighbours, decoded size 400x300.
    expectNear(imgs[0].x, start.x);
    expectNear(imgs[0].y, start.y);
    expectNear(imgs[1].x, imgs[0].x + 400 + IMAGE_LAYOUT_GAP_WORLD);
    expectNear(imgs[2].x, imgs[1].x + 400 + IMAGE_LAYOUT_GAP_WORLD);
    expectNear(imgs[0].width ?? 0, 400);
    expectNear(imgs[0].height ?? 0, 300);

    expect(uploadMock.calls).toHaveLength(3);

    // Live progress on the uploader's placeholders.
    act(() => uploadMock.calls[0].onProgress?.(50));
    expect(screen.getAllByTestId('image-upload-progress').map((e) => e.textContent)).toContain(
      'Uploading 50%',
    );

    await act(async () => {
      uploadMock.pending.forEach((p) =>
        p.resolve({ assetKey: `${'k'.repeat(22)}/a${'1'.repeat(21)}`, contentType: 'image/png' }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    flush();

    const ready = imageSnaps();
    expect(ready.every((i) => i.status === 'ready' && i.assetKey !== null)).toBe(true);
    const srcs = screen
      .getAllByTestId('image-object')
      .map((el) => (el.querySelector('img') as HTMLImageElement | null)?.src ?? '');
    expect(srcs.every((s) => s.includes(`/api/assets/${'k'.repeat(22)}/`))).toBe(true);
  });

  it('TC-18: paste while editing text adds nothing; paste with the board focused centres in view', async () => {
    render(<App />);
    connect();

    const noteId = createNote(0, 0);
    fireEvent.dblClick(noteEl(noteId));
    flush();
    expect(screen.getByTestId('sticky-textarea')).toBeTruthy();

    paste([makeFile('p.png')]);
    await act(async () => {
      await Promise.resolve();
    });
    expect(imageSnaps()).toHaveLength(0);
    expect(uploadMock.calls).toHaveLength(0);

    // Back to the bare board: the paste now lands centred in the view.
    pressAndRelease(screen.getByTestId('board-viewport'));
    flush();

    paste([makeFile('q.png')]);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const imgs = imageSnaps();
    expect(imgs).toHaveLength(1);
    const cam = readCamera();
    const centre = screenToWorld(cam, { x: VIEWPORT_SIZE.width / 2, y: VIEWPORT_SIZE.height / 2 });
    expectNear(imgs[0].x + (imgs[0].width ?? 0) / 2, centre.x, 3);
    expectNear(imgs[0].y + (imgs[0].height ?? 0) / 2, centre.y, 3);
  });

  it('TC-19: dropping while reconnecting shows the offline toast, adds nothing and uploads nothing', async () => {
    render(<App />);
    connect();
    act(() => lastProvider().emit('status', { status: 'disconnected' }));
    flush();

    await act(async () => {
      drop([makeFile('a.png')]);
      await Promise.resolve();
    });

    expect(screen.getByTestId('board-toast').textContent).toBe(OFFLINE_TOAST);
    expect(imageSnaps()).toHaveLength(0);
    expect(uploadMock.calls).toHaveLength(0);
  });

  it('TC-29: a file the decoder rejects adds nothing for itself and shows the type toast', async () => {
    render(<App />);
    connect();
    bitmapDims.set('corrupt.png', { width: 0, height: 0, decodeFails: true });

    await act(async () => {
      drop([makeFile('good.png'), makeFile('corrupt.png')]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(imageSnaps()).toHaveLength(1);
    expect(uploadMock.calls).toHaveLength(1);
    expect(screen.getByTestId('board-toast').textContent).toContain(TYPE_TOAST);
  });
});
