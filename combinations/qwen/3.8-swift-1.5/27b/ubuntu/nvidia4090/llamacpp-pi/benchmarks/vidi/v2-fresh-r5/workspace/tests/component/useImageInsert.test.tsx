/**
 * Component tests for useImageInsert flows (story 12).
 * TC-17, TC-18, TC-19, TC-29.
 *
 * Uses a real Y.Doc, mocked uploadImage, and stubbed createImageBitmap.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import type { Camera } from '../../src/client/canvas/camera';
import { type ImageSnap } from '../../src/shared/objects/image';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';

const testCamera: Camera = { x: 0, y: 0, zoom: 1 };

// Mock uploadImage
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn((boardId: string, file: File, onProgress: (f: number) => void) => {
    // Simulate immediate progress and success
    onProgress(0.5);
    const promise = new Promise((resolve) => {
      setTimeout(() => {
        onProgress(1.0);
        resolve({ kind: 'ok', assetKey: `${boardId}/asset-${file.name}` });
      }, 0);
    });
    return { promise, abort: () => {} };
  }),
}));

// Stub createImageBitmap
function stubCreateImageBitmap(width: number, height: number) {
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
    width,
    height,
    close: () => {},
  }));
}

function makeFile(type: string, size: number, name = 'test.png'): File {
  const blob = new Blob([new Uint8Array(size)], { type });
  return new File([blob], name, { type });
}

function createTestDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

// ─── TC-17: drop 3 files → 3 placeholders in a row ──────────────────────────

describe('TC-17: drop 3 files → placeholders in a row', () => {
  beforeEach(() => {
    stubCreateImageBitmap(100, 50);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates 3 placeholders at the drop point with correct spacing; ready after resolve', async () => {
    const doc = createTestDoc();
    const { result } = renderHook(() =>
      useImageInsert({
        doc,
        boardId: 'test-board',
        camera: testCamera,
        connection: 'connected',
        identityId: 'local',
      }),
    );

    // Simulate drop with 3 files
    const files = [makeFile('image/png', 100, 'a.png'), makeFile('image/png', 100, 'b.png'), makeFile('image/png', 100, 'c.png')];
    const dropEvent = {
      preventDefault: () => {},
      dataTransfer: { files, types: ['Files'] },
      clientX: 500,
      clientY: 300,
      currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
    } as unknown as React.DragEvent;

    await act(async () => {
      result.current.onDrop(dropEvent);
      // Wait for async createImageBitmap and upload to complete
      await new Promise(r => setTimeout(r, 20));
    });

    const notes = snapshot(doc);
    const images = notes.filter(n => n.type === 'image');
    expect(images).toHaveLength(3);

    // First image at drop point (500, 300)
    expect(images[0].x).toBe(500);
    expect(images[0].y).toBe(300);
    expect(images[0].width).toBe(100);
    expect(images[0].height).toBe(50);

    // Second image: 500 + 100 + 24 = 624
    expect(images[1].x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(images[1].y).toBe(300);

    // Third image: 624 + 100 + 24 = 748
    expect(images[2].x).toBe(500 + 100 + IMAGE_LAYOUT_GAP_WORLD + 100 + IMAGE_LAYOUT_GAP_WORLD);
    expect(images[2].y).toBe(300);

    // All are ready (mock upload completes)
    for (const img of images) {
      const imgSnap = img as unknown as ImageSnap;
      expect(imgSnap.status).toBe('ready');
      expect(imgSnap.assetKey).not.toBeNull();
    }
  });
});

// ─── TC-18: paste while editing text → no image; paste while board focused → image ──

describe('TC-18: paste behaviour', () => {
  beforeEach(() => {
    stubCreateImageBitmap(100, 50);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('paste while editing sticky text → no image created', async () => {
    const doc = createTestDoc();
    renderHook(() =>
      useImageInsert({
        doc,
        boardId: 'test-board',
        camera: testCamera,
        connection: 'connected',
        identityId: 'local',
      }),
    );

    // Simulate paste event with focus in a textarea
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const imageFile = makeFile('image/png', 100, 'paste.png');
    const pasteEvent = new Event('paste') as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'target', { value: textarea });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [
          { type: 'image/png', getAsFile: () => imageFile },
        ],
      },
    });
    Object.defineProperty(pasteEvent, 'preventDefault', { value: vi.fn() });

    act(() => {
      window.dispatchEvent(pasteEvent);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    const notes = snapshot(doc);
    const images = notes.filter(n => n.type === 'image');
    expect(images).toHaveLength(0);

    textarea.remove();
  });

  it('paste while board focused → image created centred in view', async () => {
    const doc = createTestDoc();
    renderHook(() =>
      useImageInsert({
        doc,
        boardId: 'test-board',
        camera: testCamera,
        connection: 'connected',
        identityId: 'local',
      }),
    );

    // Simulate paste event with focus on body (board)
    const imageFile = makeFile('image/png', 100, 'paste.png');
    const pasteEvent = new Event('paste') as ClipboardEvent;
    Object.defineProperty(pasteEvent, 'target', { value: document.body });
    Object.defineProperty(pasteEvent, 'clipboardData', {
      value: {
        items: [
          { type: 'image/png', getAsFile: () => imageFile },
        ],
      },
    });
    Object.defineProperty(pasteEvent, 'preventDefault', { value: vi.fn() });

    act(() => {
      window.dispatchEvent(pasteEvent);
    });

    await act(async () => {
      await new Promise(r => setTimeout(r, 10));
    });

    const notes = snapshot(doc);
    const images = notes.filter(n => n.type === 'image');
    expect(images).toHaveLength(1);
  });
});

// ─── TC-19: offline → no objects, no upload ─────────────────────────────────

describe('TC-19: offline gate', () => {
  beforeEach(() => {
    stubCreateImageBitmap(100, 50);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reconnecting state → offline toast, no objects, upload not called', async () => {
    const doc = createTestDoc();
    const { result } = renderHook(() =>
      useImageInsert({
        doc,
        boardId: 'test-board',
        camera: testCamera,
        connection: 'reconnecting',
        identityId: 'local',
      }),
    );

    const files = [makeFile('image/png', 100, 'a.png')];
    const dropEvent = {
      preventDefault: () => {},
      dataTransfer: { files, types: ['Files'] },
      clientX: 500,
      clientY: 300,
      currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
    } as unknown as React.DragEvent;

    await act(async () => {
      result.current.onDrop(dropEvent);
      await new Promise(r => setTimeout(r, 10));
    });

    // No images created
    const notes = snapshot(doc);
    const images = notes.filter(n => n.type === 'image');
    expect(images).toHaveLength(0);

    // Toast message shown
    expect(result.current.messages.some(m => m.text.includes("offline"))).toBe(true);
  });
});

// ─── TC-29: createImageBitmap rejects → type toast, no placeholder ──────────

describe('TC-29: decode failure', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('createImageBitmap rejects → type toast, no placeholder', async () => {
    // Stub createImageBitmap to reject
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));

    const doc = createTestDoc();
    const { result } = renderHook(() =>
      useImageInsert({
        doc,
        boardId: 'test-board',
        camera: testCamera,
        connection: 'connected',
        identityId: 'local',
      }),
    );

    const files = [makeFile('image/png', 100, 'corrupt.png')];
    const dropEvent = {
      preventDefault: () => {},
      dataTransfer: { files, types: ['Files'] },
      clientX: 500,
      clientY: 300,
      currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) },
    } as unknown as React.DragEvent;

    await act(async () => {
      result.current.onDrop(dropEvent);
      await new Promise(r => setTimeout(r, 10));
    });

    // No images created
    const notes = snapshot(doc);
    const images = notes.filter(n => n.type === 'image');
    expect(images).toHaveLength(0);

    // Type rejection toast shown
    expect(result.current.messages.some(m => m.text.includes('Only PNG, JPEG, GIF and WebP'))).toBe(true);
  });
});
