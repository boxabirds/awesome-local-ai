// @vitest-environment jsdom
/**
 * Component tests — useImageInsert flows (story 12, TC-17, TC-18, TC-19, TC-29).
 *
 * uploadImage is mocked with controllable progress/resolution; createImageBitmap
 * is stubbed globally to supply natural dimensions (jsdom has no decoder).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { snapshot } from '../../src/shared/board-model';
import type { ImageSnap } from '../../src/shared/objects/image';
import type { UploadResult } from '../../src/client/images/uploadImage';

interface MockUpload {
  boardId: string;
  file: File;
  onProgress: (f: number) => void;
  resolve: (r: UploadResult) => void;
  promise: Promise<UploadResult>;
}

let uploads: MockUpload[] = [];

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (boardId: string, file: File, onProgress: (f: number) => void) => {
    let resolveFn: (r: UploadResult) => void = () => {};
    const promise = new Promise<UploadResult>((res) => {
      resolveFn = res;
    });
    const handle: MockUpload = { boardId, file, onProgress, resolve: resolveFn, promise };
    uploads.push(handle);
    return { promise, abort: vi.fn() };
  },
}));

const CAMERA = { x: 0, y: 0, zoom: 1 };
const VIEWPORT = { width: 1280, height: 800 };

function makeFile(name: string, type = 'image/png', size = 100): File {
  return new File([new Uint8Array(size)], name, { type });
}

function stubBitmap(width: number, height: number) {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(() =>
      Promise.resolve({ width, height, close: vi.fn() }),
    ),
  );
}

function imagesIn(doc: Y.Doc): ImageSnap[] {
  return snapshot(doc).filter((o) => o.type === 'image') as ImageSnap[];
}

function makeDrop(files: File[], clientX = 100, clientY = 100): React.DragEvent {
  return {
    preventDefault: vi.fn(),
    clientX,
    clientY,
    dataTransfer: { files, types: ['Files'], dropEffect: 'none' } as unknown as DataTransfer,
  } as React.DragEvent;
}

function makePaste(files: File[]): ClipboardEvent {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { items: files.map((f) => ({ kind: 'file', getAsFile: () => f })) },
  });
  return event as ClipboardEvent;
}

describe('useImageInsert', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    uploads = [];
    doc = new Y.Doc();
    stubBitmap(100, 80);
  });

  afterEach(() => {
    cleanup();
    doc.destroy();
    vi.unstubAllGlobals();
  });

  it('TC-17: dropping 3 files creates 3 placeholders in a row; progress updates; ready after resolve', async () => {
    const { result } = renderHook(() =>
      useImageInsert({ doc, boardId: 'board1', camera: CAMERA, connection: 'connected', identityId: 'u1', viewportSize: VIEWPORT }),
    );

    const files = [makeFile('a.png'), makeFile('b.png'), makeFile('c.png')];
    await act(async () => {
      result.current.onDrop(makeDrop(files));
    });

    // 3 placeholders in a row (left to right, same top).
    let imgs = imagesIn(doc);
    expect(imgs).toHaveLength(3);
    const ys = new Set(imgs.map((i) => i.y));
    expect(ys.size).toBe(1);
    const xs = imgs.map((i) => i.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    expect(imgs.every((i) => i.status === 'uploading')).toBe(true);

    // Emit progress through the mocked uploads → progress map reflects it.
    await act(async () => {
      for (const u of uploads) u.onProgress(0.5);
    });
    for (const img of imgs) {
      expect(result.current.progress.get(img.id)).toBe(0.5);
    }

    // Resolve all uploads → ready.
    await act(async () => {
      for (const u of uploads) u.resolve({ kind: 'ok', assetKey: 'board1/assetX' });
    });
    imgs = imagesIn(doc);
    expect(imgs.every((i) => i.status === 'ready')).toBe(true);
    expect(imgs.every((i) => i.assetKey === 'board1/assetX')).toBe(true);
  });

  it('TC-18: paste while editing text adds nothing; paste with the board focused adds a centred image', async () => {
    const { result } = renderHook(() =>
      useImageInsert({ doc, boardId: 'board1', camera: CAMERA, connection: 'connected', identityId: 'u1', viewportSize: VIEWPORT }),
    );

    // While a text field is focused, paste is left to the editor.
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    await act(async () => {
      window.dispatchEvent(makePaste([makeFile('p.png')]));
    });
    expect(imagesIn(doc)).toHaveLength(0);
    input.remove();

    // With the board focused (no input), paste adds a centred image.
    document.body.focus();
    await act(async () => {
      window.dispatchEvent(makePaste([makeFile('p.png')]));
    });
    const imgs = imagesIn(doc);
    expect(imgs).toHaveLength(1);
    // Centre of the viewport in world (camera identity) = (640, 400).
    // placementSize(100,80) → 100x80; centre anchor centres the row on x and
    // top-aligns to start.y → x = 640 - 50, y = 400.
    expect(imgs[0].x).toBeCloseTo(590, 3);
    expect(imgs[0].y).toBeCloseTo(400, 3);
  });

  it('TC-19: offline (reconnecting) drop shows the offline toast, creates nothing, and never uploads', async () => {
    const { result } = renderHook(() =>
      useImageInsert({ doc, boardId: 'board1', camera: CAMERA, connection: 'reconnecting', identityId: 'u1', viewportSize: VIEWPORT }),
    );

    await act(async () => {
      result.current.onDrop(makeDrop([makeFile('a.png')]));
    });

    expect(result.current.toast).toBe(REJECTION_MESSAGES.offline);
    expect(imagesIn(doc)).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it('TC-29: a file that fails to decode (createImageBitmap rejects) → type toast, no placeholder', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.reject(new Error('decode'))));

    const { result } = renderHook(() =>
      useImageInsert({ doc, boardId: 'board1', camera: CAMERA, connection: 'connected', identityId: 'u1', viewportSize: VIEWPORT }),
    );

    await act(async () => {
      result.current.onDrop(makeDrop([makeFile('bad.png')]));
    });

    expect(result.current.toast).toBe(REJECTION_MESSAGES.type);
    expect(imagesIn(doc)).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });
});
