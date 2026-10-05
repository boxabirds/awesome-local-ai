/**
 * Component tests for image insert flows (TC-17, TC-18, TC-19, TC-29).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import type { ConnectionState } from '../../src/client/sync/connectBoard';


// Mock uploadImage
const mockUploadImage = vi.fn((_boardId: string, _file: File, onProgress: (f: number) => void) => {
  let resolvePromise: (result: any) => void = () => {};
  const promise = new Promise((resolve) => { resolvePromise = resolve; });
  onProgress(0);
  return {
    promise,
    abort: vi.fn(),
    _resolve: (result: any) => {
      act(() => onProgress(1));
      resolvePromise(result);
    },
  };
});

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (...args: any[]) => mockUploadImage(...(args as [string, File, (f: number) => void])),
}));



// Stub createImageBitmap
const mockBitmap = { width: 100, height: 80, close: vi.fn() };
(globalThis as any).createImageBitmap = vi.fn(async () => mockBitmap);

beforeEach(() => {
  mockUploadImage.mockClear();
});

function makeFile(name: string, type: string, size = 100): File {
  return new File([new ArrayBuffer(size)], name, { type });
}

function renderWithState(overrides: Partial<{
  connection: ConnectionState;
  boardId: string;
  identityId: string;
  onToast: (msg: string) => void;
}> = {}) {
  const doc = new Y.Doc();
  const toasts: string[] = [];
  const args = {
    doc,
    boardId: overrides.boardId ?? 'board1234567890123456',
    camera: { x: 0, y: 0, zoom: 1 },
    connection: overrides.connection ?? 'connected' as ConnectionState,
    identityId: overrides.identityId ?? 'user1',
    viewportCentreWorld: () => ({ x: 400, y: 300 }),
    onToast: overrides.onToast ?? ((msg: string) => toasts.push(msg)),
  };
  const result = renderHook(() => useImageInsert(args));
  return { ...result, doc, toasts };
}

describe('TC-17: drop 3 files creates 3 placeholders in a row', () => {
  it('creates placeholders and transitions to ready', async () => {
    const { result, doc } = renderWithState();
    const files = [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
      makeFile('c.png', 'image/png'),
    ];

    // Simulate drop
    const dropEvent = new Event('drop') as any;
    dropEvent.dataTransfer = {
      types: ['Files'],
      files,
    };
    dropEvent.clientX = 100;
    dropEvent.clientY = 200;
    dropEvent.preventDefault = vi.fn();

    await act(async () => {
      result.current.onDrop(dropEvent);
      // Wait for async createImageBitmap
      await new Promise((r) => setTimeout(r, 10));
    });

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.size).toBe(3);

    // All should be uploading initially (progress map populated)
    for (const [, obj] of objects) {
      expect(obj.get('status')).toBe('uploading');
      expect(obj.get('type')).toBe('image');
    }

    // Resolve all uploads
    const calls = mockUploadImage.mock.results;
    for (const call of calls) {
      const handle = call.value;
      if (handle._resolve) {
        await act(async () => {
          handle._resolve({ kind: 'ok', assetKey: 'board/asset' });
        });
      }
    }

    // After resolution, all should be ready
    for (const [, obj] of objects) {
      expect(obj.get('status')).toBe('ready');
      expect(obj.get('assetKey')).toBe('board/asset');
    }
  });
});

describe('TC-18: paste respects text editing', () => {
  it('paste while editing text does not add an image', async () => {
    const { result, doc } = renderWithState();

    const textarea = document.createElement('textarea');
    const file = makeFile('img.png', 'image/png');
    const pasteEvent = { target: textarea, clipboardData: { files: [file] }, preventDefault: vi.fn() } as unknown as ClipboardEvent;

    act(() => {
      result.current.onPaste(pasteEvent);
    });

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.size).toBe(0);
    expect(pasteEvent.preventDefault).not.toHaveBeenCalled();
  });

  it('paste with board focused adds an image centred in view', async () => {
    const { result, doc } = renderWithState();
    const file = makeFile('img.png', 'image/png');
    const pasteEvent = { target: document.body, clipboardData: { files: [file] }, preventDefault: vi.fn() } as unknown as ClipboardEvent;

    await act(async () => {
      result.current.onPaste(pasteEvent);
      await new Promise((r) => setTimeout(r, 10));
    });

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.size).toBe(1);
    expect(pasteEvent.preventDefault).toHaveBeenCalled();

    // Should be centred around (400, 300) with 100x80 natural → same placement size
    for (const [, obj] of objects) {
      // Centred: x = 400 - 100/2 = 350, y = 300 - 80/2 = 260
      expect(obj.get('x')).toBe(350);
      expect(obj.get('y')).toBe(260);
    }
  });
});

describe('TC-19: offline drop shows toast and adds nothing', () => {
  it('reconnecting state prevents upload', async () => {
    const { result, doc, toasts } = renderWithState({ connection: 'reconnecting' });
    const files = [makeFile('a.png', 'image/png')];

    const dropEvent = new Event('drop') as any;
    dropEvent.dataTransfer = { types: ['Files'], files };
    dropEvent.clientX = 100;
    dropEvent.clientY = 200;
    dropEvent.preventDefault = vi.fn();

    await act(async () => {
      result.current.onDrop(dropEvent);
    });

    expect(toasts).toContain("You're offline \u2014 images can be added when you reconnect.");
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.size).toBe(0);
    expect(mockUploadImage).not.toHaveBeenCalled();
  });
});

describe('TC-29: createImageBitmap rejects for corrupt file', () => {
  it('shows type toast and creates no placeholder', async () => {
    // Make createImageBitmap reject for this test
    (globalThis as any).createImageBitmap = vi.fn(async () => {
      throw new Error('decode error');
    });

    const { result, doc, toasts } = renderWithState();
    const file = makeFile('corrupt.png', 'image/png');

    const dropEvent = new Event('drop') as any;
    dropEvent.dataTransfer = { types: ['Files'], files: [file] };
    dropEvent.clientX = 100;
    dropEvent.clientY = 200;
    dropEvent.preventDefault = vi.fn();

    await act(async () => {
      result.current.onDrop(dropEvent);
      await new Promise((r) => setTimeout(r, 10));
    });

    expect(toasts).toContain('Only PNG, JPEG, GIF and WebP images can be added.');
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    expect(objects.size).toBe(0);

    // Restore
    (globalThis as any).createImageBitmap = vi.fn(async () => mockBitmap);
  });
});
