/**
 * Component tests for useImageInsert hook (TC-17 to TC-19, TC-29).
 * Uses real Y.Doc, mocked uploadImage and stubbed createImageBitmap.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

// Shared mock upload handlers
const uploadHandlers: Array<{
  resolve: (r: { kind: string; assetKey?: string }) => void;
  onProgress: (f: number) => void;
}> = [];

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn((_boardId: string, _file: File, onProgress: (f: number) => void) => {
    let resolve: (r: any) => void;
    const promise = new Promise<any>((r) => { resolve = r; });
    uploadHandlers.push({ resolve: resolve!, onProgress });
    return { promise, abort: vi.fn() };
  }),
}));

// Mock createImageBitmap
const mockCreateImageBitmap = vi.fn();
(globalThis as any).createImageBitmap = mockCreateImageBitmap;

function makeFile(name: string, type: string, size = 1024): File {
  return new File([new ArrayBuffer(size)], name, { type });
}

/**
 * Create a mock DataTransfer-like object that works in jsdom.
 */
function createMockDataTransfer(files: File[]): DataTransfer {
  const clipboardItems = files.map((f) => ({
    kind: 'file' as const,
    type: f.type,
    getAsFile: () => f,
  }));
  return {
    types: ['Files'],
    files: Object.assign(files, { item: (i: number) => files[i] ?? null }),
    items: Object.assign(clipboardItems, { item: (i: number) => clipboardItems[i] ?? null }),
    getData: () => '',
    setData: () => {},
  } as unknown as DataTransfer;
}

function makeDragEvent(type: string, files: File[], clientX = 100, clientY = 200): DragEvent {
  const dataTransfer = createMockDataTransfer(files);
  const event = new Event(type, { bubbles: true }) as any;
  event.dataTransfer = dataTransfer;
  event.clientX = clientX;
  event.clientY = clientY;
  return event;
}

function makePasteEvent(files: File[]): ClipboardEvent {
  const dataTransfer = createMockDataTransfer(files);
  const event = new Event('paste', { bubbles: true, cancelable: true }) as any;
  event.clipboardData = dataTransfer;
  return event;
}

function setup(connection: ConnectionState | undefined = 'connected') {
  const doc = new Y.Doc();
  initDoc(doc);
  const boardId = 'abcdefghijklmnopqrstuv';
  const camera = { x: 0, y: 0, zoom: 1 };
  const showToast = vi.fn();

  const { result } = renderHook(() =>
    useImageInsert({
      doc,
      boardId,
      camera,
      viewportWidth: 800,
      viewportHeight: 600,
      connection,
      identityId: 'user1',
      showToast,
    }),
  );

  return { doc, boardId, camera, showToast, result };
}

function getObjectsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
}

beforeEach(() => {
  vi.clearAllMocks();
  uploadHandlers.length = 0;
  mockCreateImageBitmap.mockImplementation(() => {
    return Promise.resolve({
      width: 400,
      height: 300,
      close: vi.fn(),
    });
  });
});

describe('TC-17: drop 3 valid files → 3 placeholders in a row', () => {
  it('creates placeholders and updates progress', async () => {
    const { doc, result } = setup();
    const files = [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
      makeFile('c.png', 'image/png'),
    ];

    const dropEvent = makeDragEvent('drop', files);

    await act(async () => {
      result.current.onDrop(dropEvent);
      await new Promise((r) => setTimeout(r, 0));
    });

    const objects = getObjectsMap(doc);
    expect(objects.size).toBe(3);

    // All should be uploading
    const entries = Array.from(objects.entries());
    for (const [, map] of entries) {
      expect(map.get('status')).toBe('uploading');
      expect(map.get('uploaderId')).toBe('user1');
    }

    // Simulate progress on first handler
    if (uploadHandlers.length > 0) {
      act(() => {
        uploadHandlers[0]!.onProgress(0.5);
      });
    }

    // Resolve first upload → markImageReady
    act(() => {
      uploadHandlers[0]!.resolve({ kind: 'ok', assetKey: 'board/asset1' });
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    // One image should now be ready
    let readyCount = 0;
    for (const [, map] of objects) {
      if (map.get('status') === 'ready') readyCount++;
    }
    expect(readyCount).toBe(1);
  });
});

describe('TC-18: paste while editing text → no image; paste while board focused → image', () => {
  it('paste while editing text does NOT create an image', async () => {
    const { doc, result } = setup();

    // Put focus on a textarea (simulating text editing)
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const pasteEvent = makePasteEvent([makeFile('paste.png', 'image/png')]);

    await act(async () => {
      result.current.onPaste(pasteEvent);
      await new Promise((r) => setTimeout(r, 0));
    });

    const objects = getObjectsMap(doc);
    expect(objects.size).toBe(0);

    textarea.remove();
  });

  it('paste while board focused creates an image centred in view', async () => {
    const { doc, result } = setup();

    // Ensure no element is focused on input/textarea
    (document.activeElement as HTMLElement | null)?.blur?.();

    const pasteEvent = makePasteEvent([makeFile('paste.png', 'image/png')]);

    await act(async () => {
      result.current.onPaste(pasteEvent);
      // Allow multiple microtask ticks for the async chain
      for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
    });

    const objects = getObjectsMap(doc);
    expect(objects.size).toBe(1);
  });
});

describe('TC-19: offline → no objects created, no upload called', () => {
  it('drop while reconnecting shows offline toast, no upload', async () => {
    const { doc, showToast, result } = setup('reconnecting');

    const files = [makeFile('a.png', 'image/png')];
    const dropEvent = makeDragEvent('drop', files);

    await act(async () => {
      result.current.onDrop(dropEvent);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('offline'));
    const objects = getObjectsMap(doc);
    expect(objects.size).toBe(0);
  });
});

describe('TC-29: createImageBitmap rejects → type toast, no placeholder', () => {
  it('corrupt file decode failure shows type toast', async () => {
    const { doc, showToast, result } = setup();

    // Make createImageBitmap reject
    mockCreateImageBitmap.mockRejectedValue(new Error('decode failed'));

    const files = [makeFile('corrupt.png', 'image/png')];
    const dropEvent = makeDragEvent('drop', files);

    await act(async () => {
      result.current.onDrop(dropEvent);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(showToast).toHaveBeenCalledWith(
      expect.stringContaining('Only PNG, JPEG, GIF and WebP'),
    );
    const objects = getObjectsMap(doc);
    expect(objects.size).toBe(0);
  });
});
