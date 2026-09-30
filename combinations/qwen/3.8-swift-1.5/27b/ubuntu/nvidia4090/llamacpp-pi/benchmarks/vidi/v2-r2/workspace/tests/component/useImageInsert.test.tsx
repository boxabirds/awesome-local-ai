import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import { uploadImage } from '../../src/client/images/uploadImage';
import { objectSnapshot } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';

// Mock uploadImage
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn(),
}));

function makeDropEvent(files: File[], clientX = 200, clientY = 100): any {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: clientX },
    clientY: { value: clientY },
    dataTransfer: { value: { files, types: ['Files'] } },
    currentTarget: { value: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
    preventDefault: { value: vi.fn() },
    stopPropagation: { value: vi.fn() },
  });
  return event;
}

// Stub createImageBitmap (jsdom doesn't have it)
const mockCreateImageBitmap = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('createImageBitmap', mockCreateImageBitmap);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function setupMockUpload() {
  const mockUpload = vi.mocked(uploadImage);
  type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };
  let resolvers: Array<(result: UploadResult) => void> = [];

  mockUpload.mockImplementation((_boardId, _file, _onProgress) => {
    let resolve: (result: UploadResult) => void;
    const promise = new Promise<UploadResult>((r) => { resolve = r; });
    resolvers.push(resolve!);
    return { promise, abort: vi.fn() };
  });

  return {
    mockUpload,
    resolveAll: () => {
      resolvers.forEach((r, i) => r({ kind: 'ok', assetKey: `board/asset${i}` }));
      resolvers = [];
    },
    resolveFailed: () => {
      resolvers.forEach((r) => r({ kind: 'failed', status: 500 }));
      resolvers = [];
    },
  };
}

function makeFiles(count: number, type = 'image/png'): File[] {
  return Array.from({ length: count }, (_, i) => {
    const content = new Uint8Array(100);
    return new File([content], `test${i}.png`, { type });
  });
}

describe('TC-17: drop 3 valid files → 3 placeholders in a row', () => {
  it('creates placeholders with progress and ready after resolve', async () => {
    const { mockUpload, resolveAll } = setupMockUpload();
    const doc = new Y.Doc();
    const camera = { x: 0, y: 0, zoom: 1 };
    const showToast = vi.fn();

    // Mock createImageBitmap to return 100x50 images
    mockCreateImageBitmap.mockImplementation(() =>
      Promise.resolve({ width: 100, height: 50, close: vi.fn() })
    );

    const { result } = renderHook(() =>
      useImageInsert({
        doc,
        boardId: 'test-board',
        camera,
        connection: 'connected',
        identityId: 'user-1',
        showToast,
        viewportSize: { width: 800, height: 600 },
      })
    );

    // Simulate drop
    const files = makeFiles(3);
    const dropEvent = makeDropEvent(files);

    await act(async () => {
      result.current.onDrop(dropEvent);
    });

    // Wait for async createImageBitmap
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    // Check that 3 placeholders were created
    const objects = objectSnapshot(doc);
    const images = objects.filter((o) => o.type === 'image');
    expect(images).toHaveLength(3);

    // Check they are in a row with gaps
    expect(images[0].x).toBe(200);
    expect(images[1].x).toBe(200 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(images[2].x).toBe(200 + 100 + IMAGE_LAYOUT_GAP_WORLD + 100 + IMAGE_LAYOUT_GAP_WORLD);

    // Check upload was called
    expect(mockUpload).toHaveBeenCalledTimes(3);

    // Resolve uploads
    await act(async () => {
      resolveAll();
      await new Promise((r) => setTimeout(r, 10));
    });

    // Check images are now ready
    const objectsAfter = objectSnapshot(doc);
    const readyImages = objectsAfter.filter((o) => o.type === 'image' && (o as any).status === 'ready');
    expect(readyImages).toHaveLength(3);
  });
});

describe('TC-18: paste behaviour', () => {
  it('paste while editing text → no image created', async () => {
    setupMockUpload();
    const doc = new Y.Doc();
    const camera = { x: 0, y: 0, zoom: 1 };

    mockCreateImageBitmap.mockImplementation(() =>
      Promise.resolve({ width: 100, height: 50, close: vi.fn() })
    );

    const { result } = renderHook(() =>
      useImageInsert({
        doc,
        boardId: 'test-board',
        camera,
        connection: 'connected',
        identityId: 'user-1',
        showToast: vi.fn(),
        viewportSize: { width: 800, height: 600 },
      })
    );

    // Simulate focus on a textarea
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const pasteEvent = new Event('paste') as any;
    pasteEvent.clipboardData = {
      items: [{ type: 'image/png', getAsFile: () => new File([new Uint8Array(100)], 'test.png', { type: 'image/png' }) }],
    };
    pasteEvent.preventDefault = vi.fn();

    act(() => {
      result.current.onPaste(pasteEvent);
    });

    // No image should be created
    const objects = objectSnapshot(doc);
    expect(objects.filter((o) => o.type === 'image')).toHaveLength(0);

    textarea.remove();
  });

  it('paste while board focused → image centred in view', async () => {
    setupMockUpload();
    const doc = new Y.Doc();
    const camera = { x: 0, y: 0, zoom: 1 };

    mockCreateImageBitmap.mockImplementation(() =>
      Promise.resolve({ width: 100, height: 50, close: vi.fn() })
    );

    const { result } = renderHook(() =>
      useImageInsert({
        doc,
        boardId: 'test-board',
        camera,
        connection: 'connected',
        identityId: 'user-1',
        showToast: vi.fn(),
        viewportSize: { width: 800, height: 600 },
      })
    );

    // Ensure no text element is focused
    (document.activeElement as HTMLElement | null)?.blur?.();

    const pasteEvent = new Event('paste') as any;
    pasteEvent.clipboardData = {
      items: [{ type: 'image/png', getAsFile: () => new File([new Uint8Array(100)], 'test.png', { type: 'image/png' }) }],
    };
    pasteEvent.preventDefault = vi.fn();

    await act(async () => {
      result.current.onPaste(pasteEvent);
      await new Promise((r) => setTimeout(r, 10));
    });

    const objects = objectSnapshot(doc);
    const images = objects.filter((o) => o.type === 'image');
    expect(images).toHaveLength(1);

    // Should be centred: viewport centre is (400, 300), image is 100x50
    // So x = 400 - 50 = 350, y = 300 - 25 = 275
    expect(images[0].x).toBeCloseTo(350, 0);
    expect(images[0].y).toBeCloseTo(275, 0);
  });
});

describe('TC-19: offline → no objects, no upload', () => {
  it('ConnectionState reconnecting then drop → offline toast; no objects; upload not called', async () => {
    const { mockUpload } = setupMockUpload();
    const doc = new Y.Doc();
    const camera = { x: 0, y: 0, zoom: 1 };
    const showToast = vi.fn();

    mockCreateImageBitmap.mockImplementation(() =>
      Promise.resolve({ width: 100, height: 50, close: vi.fn() })
    );

    const { result } = renderHook(() =>
      useImageInsert({
        doc,
        boardId: 'test-board',
        camera,
        connection: 'reconnecting',
        identityId: 'user-1',
        showToast,
        viewportSize: { width: 800, height: 600 },
      })
    );

    const files = makeFiles(1);
    const dropEvent = makeDropEvent(files);

    act(() => {
      result.current.onDrop(dropEvent);
    });

    // Offline toast shown
    expect(showToast).toHaveBeenCalledWith("You're offline — images can be added when you reconnect.");

    // No objects created
    const objects = objectSnapshot(doc);
    expect(objects.filter((o) => o.type === 'image')).toHaveLength(0);

    // Upload not called
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('TC-29: createImageBitmap rejects → type toast, no placeholder', () => {
  it('corrupt file → type toast, no placeholder', async () => {
    const { mockUpload } = setupMockUpload();
    const doc = new Y.Doc();
    const camera = { x: 0, y: 0, zoom: 1 };
    const showToast = vi.fn();

    // Mock createImageBitmap to reject
    mockCreateImageBitmap.mockRejectedValue(new Error('Decode error'));

    const { result } = renderHook(() =>
      useImageInsert({
        doc,
        boardId: 'test-board',
        camera,
        connection: 'connected',
        identityId: 'user-1',
        showToast,
        viewportSize: { width: 800, height: 600 },
      })
    );

    const files = makeFiles(1);
    const dropEvent = makeDropEvent(files);

    await act(async () => {
      result.current.onDrop(dropEvent);
      await new Promise((r) => setTimeout(r, 10));
    });

    // Type toast shown
    expect(showToast).toHaveBeenCalledWith('Only PNG, JPEG, GIF and WebP images can be added.');

    // No placeholders created
    const objects = objectSnapshot(doc);
    expect(objects.filter((o) => o.type === 'image')).toHaveLength(0);

    // Upload not called
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
