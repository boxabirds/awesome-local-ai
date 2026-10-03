// Component tests for image insert flows (story 12).
// TC-17: drop 3 files → 3 placeholders in a row; progress updates; ready after resolve
// TC-18: paste while editing → no image; paste while board focused → image centred
// TC-19: offline → toast; no objects; upload not called
// TC-29: createImageBitmap rejects → type toast, no placeholder

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import { uploadImage } from '../../src/client/images/uploadImage';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { readImageSnap } from '../../src/shared/objects/image';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import type { Camera } from '../../src/client/canvas/camera';

// Mock uploadImage
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn(),
}));

// Stub createImageBitmap in jsdom
const mockBitmaps = new Map<File, { width: number; height: number }>();
beforeEach(() => {
  mockBitmaps.clear();
  vi.stubGlobal('createImageBitmap', vi.fn(async (file: File) => {
    const dims = mockBitmaps.get(file);
    if (!dims) throw new Error('decode failed');
    return {
      width: dims.width,
      height: dims.height,
      close: () => {},
    };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mockCamera: Camera = { x: -640, y: -400, zoom: 1 };

function makeTestFile(type: string, name: string): File {
  const f = new File(['test'], name, { type });
  mockBitmaps.set(f, { width: 200, height: 100 });
  return f;
}

function setupHook(opts: {
  connection?: string;
  boardId?: string;
} = {}) {
  const doc = new Y.Doc();
  initDoc(doc);
  const boardId = opts.boardId ?? 'a'.repeat(22);
  const connection = opts.connection ?? 'connected';
  const toastShow = vi.fn();
  const toast = { show: toastShow };

  const { result } = renderHook(() => useImageInsert({
    doc,
    boardId,
    camera: mockCamera,
    connection: connection as any,
    identityId: 'local',
    toast,
    viewportSize: { width: 1280, height: 800 },
  }));

  return { doc, api: result.current, toastShow, boardId };
}

describe('TC-17: drop 3 files → 3 placeholders in a row; progress updates; ready', () => {
  it('creates 3 placeholders, tracks progress, marks ready', async () => {
    const { doc, api, toastShow } = setupHook();
    const mockUpload = vi.mocked(uploadImage);

    // 3 files
    const files = [makeTestFile('image/png', 'a.png'), makeTestFile('image/jpeg', 'b.jpg'), makeTestFile('image/gif', 'c.gif')];

    // Mock upload to resolve with ok
    mockUpload.mockImplementation((_boardId, _file, onProgress) => {
      const p = new Promise<any>((resolve) => {
        setTimeout(() => {
          onProgress(0.5);
          resolve({ kind: 'ok', assetKey: 'board/asset' });
        }, 10);
      });
      return { promise: p, abort: vi.fn() };
    });

    // Simulate drop at world point (0, 0)
    // screenToWorld(camera, {x: 640, y: 400}) = {x: 0, y: 0} with our camera
    await act(async () => {
      api.onDrop({
        preventDefault: vi.fn(),
        dataTransfer: { files, types: ['Files'] },
        clientX: 640,
        clientY: 400,
        currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
      } as any);
    });

    // Wait for async operations
    await act(async () => {
      await new Promise(r => setTimeout(r, 50));
    });

    // 3 objects created
    const objs = snapshot(doc);
    const images = objs.filter(o => o.type === 'image');
    expect(images).toHaveLength(3);

    // All are in a row with gap
    expect(images[0].x).toBe(0);
    expect(images[1].x).toBe(images[0].x + (images[0].width ?? 0) + IMAGE_LAYOUT_GAP_WORLD);
    expect(images[2].x).toBe(images[1].x + (images[1].width ?? 0) + IMAGE_LAYOUT_GAP_WORLD);

    // All tops aligned
    expect(images[0].y).toBe(0);
    expect(images[1].y).toBe(0);
    expect(images[2].y).toBe(0);

    // After upload completes, all are ready
    for (const img of images) {
      const snap = readImageSnap(doc, img.id)!;
      expect(snap.status).toBe('ready');
      expect(snap.assetKey).toBe('board/asset');
    }
  });
});

describe('TC-18: paste behaviour', () => {
  it('paste while editing text → no image created', async () => {
    const { doc, api } = setupHook();
    const mockUpload = vi.mocked(uploadImage);
    mockUpload.mockReturnValue({ promise: Promise.resolve({ kind: 'ok', assetKey: 'a/b' }), abort: vi.fn() });

    // Simulate focus in a textarea
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const file = makeTestFile('image/png', 'paste.png');
    const clipboardItem = { type: 'image/png', getAsFile: () => file };

    await act(async () => {
      api.onPaste({
        clipboardData: { items: [clipboardItem] },
        preventDefault: vi.fn(),
      } as any);
    });

    // No image created
    const objs = snapshot(doc).filter(o => o.type === 'image');
    expect(objs).toHaveLength(0);
    expect(mockUpload).not.toHaveBeenCalled();

    document.body.removeChild(textarea);
  });

  it('paste while board focused → image centred in view', async () => {
    const { doc, api } = setupHook();
    const mockUpload = vi.mocked(uploadImage);
    mockUpload.mockReturnValue({ promise: Promise.resolve({ kind: 'ok', assetKey: 'a/b' }), abort: vi.fn() });

    // Ensure no text editor has focus
    document.body.focus();

    const file = makeTestFile('image/png', 'paste.png');
    const clipboardItem = { type: 'image/png', getAsFile: () => file };

    await act(async () => {
      api.onPaste({
        clipboardData: { items: [clipboardItem] },
        preventDefault: vi.fn(),
      } as any);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    // Image created and centred
    const objs = snapshot(doc).filter(o => o.type === 'image');
    expect(objs).toHaveLength(1);
    // Centre of view with camera {x:-640, y:-400, zoom:1}: world centre = (0, 0)
    // Image is 200x100, centred → x = -100, y = -50
    expect(objs[0].x).toBeCloseTo(-100, 0);
    expect(objs[0].y).toBeCloseTo(-50, 0);
  });
});

describe('TC-19: offline → toast; no objects; upload not called', () => {
  it('drop while reconnecting → offline toast, nothing created', async () => {
    const { doc, api, toastShow } = setupHook({ connection: 'reconnecting' });
    const mockUpload = vi.mocked(uploadImage);

    const files = [makeTestFile('image/png', 'a.png')];

    await act(async () => {
      api.onDrop({
        preventDefault: vi.fn(),
        dataTransfer: { files, types: ['Files'] },
        clientX: 640,
        clientY: 400,
        currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      } as any);
    });

    expect(toastShow).toHaveBeenCalledWith(REJECTION_MESSAGES.offline);
    expect(snapshot(doc).filter(o => o.type === 'image')).toHaveLength(0);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('TC-29: createImageBitmap rejects → type toast, no placeholder', () => {
  it('corrupt file → type toast, no placeholder', async () => {
    const { doc, api, toastShow } = setupHook();
    const mockUpload = vi.mocked(uploadImage);
    mockUpload.mockReturnValue({ promise: Promise.resolve({ kind: 'ok', assetKey: 'a/b' }), abort: vi.fn() });

    // File that will fail to decode
    const corruptFile = new File(['garbage'], 'corrupt.png', { type: 'image/png' });
    // Don't add to mockBitmaps → createImageBitmap will throw

    await act(async () => {
      api.onDrop({
        preventDefault: vi.fn(),
        dataTransfer: { files: [corruptFile], types: ['Files'] },
        clientX: 640,
        clientY: 400,
        currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
      } as any);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    expect(toastShow).toHaveBeenCalledWith(REJECTION_MESSAGES.type);
    expect(snapshot(doc).filter(o => o.type === 'image')).toHaveLength(0);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});
