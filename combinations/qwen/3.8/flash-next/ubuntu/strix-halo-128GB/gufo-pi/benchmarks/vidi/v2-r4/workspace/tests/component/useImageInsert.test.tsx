/**
 * Component tests for useImageInsert (TC-17 to TC-19, TC-29).
 * Uses a real Y.Doc with mocked uploadImage and stubbed createImageBitmap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';

// Mock uploadImage before importing the hook
const mockUpload = vi.fn();
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (...args: any[]) => mockUpload(...args),
}));

import { useImageInsert } from '../../src/client/images/useImageInsert';
import type { ConnectionState } from '../../src/client/sync/connectBoard';

function makeFile(name: string, type: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type });
}

interface TestHarnessProps {
  doc: Y.Doc;
  connection: ConnectionState;
  onShowToast(msg: string): void;
  getViewCentre(): { x: number; y: number } | null;
  onHook(h: ReturnType<typeof useImageInsert>): void;
}

function TestHarness({ doc, connection, onShowToast, getViewCentre, onHook }: TestHarnessProps) {
  const hook = useImageInsert({
    doc,
    boardId: 'test-board-id-22chars!!!',
    camera: { x: 0, y: 0, zoom: 1 },
    connection,
    identityId: 'local',
    showToast: onShowToast,
    getViewCentre,
  });
  onHook(hook);
  return null;
}

describe('useImageInsert drop (TC-17)', () => {
  let doc: Y.Doc;
  let toasts: string[];
  let hookResult: any;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    toasts = [];
    hookResult = null;
    mockUpload.mockReset();
    // Stub createImageBitmap
    (globalThis as any).createImageBitmap = vi.fn().mockResolvedValue({
      width: 100,
      height: 200,
      close: vi.fn(),
    });
  });

  it('drop 3 valid files → 3 placeholders in a row; progress updates; ready after resolve', async () => {
    let resolveUploads: ((v: { kind: 'ok'; assetKey: string }) => void)[] = [];

    mockUpload.mockImplementation((_boardId: string, _file: File, onProgress: (f: number) => void) => {
      const promise = new Promise<{ kind: 'ok'; assetKey: string }>((resolve) => {
        resolveUploads.push(resolve);
      });
      // Emit initial progress
      setTimeout(() => onProgress(0.5), 0);
      return { promise, abort: vi.fn() };
    });

    render(
      <TestHarness
        doc={doc}
        connection="connected"
        onShowToast={(m) => toasts.push(m)}
        getViewCentre={() => ({ x: 400, y: 300 })}
        onHook={(h) => { hookResult = h; }}
      />,
    );

    // Simulate drop
    const files = [makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png'), makeFile('c.png', 'image/png')];
    const dropEvent = new Event('drop') as any;
    dropEvent.preventDefault = vi.fn();
    dropEvent.dataTransfer = { files, types: ['Files'] };
    dropEvent.offsetX = 50;
    dropEvent.offsetY = 60;

    await act(async () => {
      hookResult.onDrop(dropEvent);
    });

    // Wait for createImageBitmap and processing
    await waitFor(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      let count = 0;
      for (const obj of objects.values()) {
        if (obj.get('type') === 'image') count++;
      }
      expect(count).toBe(3);
    });

    // Progress should have been emitted
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });
    expect(hookResult.progress.size).toBe(3);

    // Resolve all uploads
    await act(async () => {
      for (const resolve of resolveUploads) {
        resolve({ kind: 'ok', assetKey: 'test-board-id-22chars!!!/abc' });
      }
      await new Promise(r => setTimeout(r, 10));
    });

    // Check objects are now ready
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    let readyCount = 0;
    for (const obj of objects.values()) {
      if (obj.get('type') === 'image' && obj.get('status') === 'ready') readyCount++;
    }
    expect(readyCount).toBe(3);
  });
});

describe('useImageInsert paste (TC-18)', () => {
  let doc: Y.Doc;
  let toasts: string[];
  let hookResult: any;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    toasts = [];
    hookResult = null;
    mockUpload.mockReset();
    (globalThis as any).createImageBitmap = vi.fn().mockResolvedValue({
      width: 100,
      height: 100,
      close: vi.fn(),
    });
  });

  it('paste while editing text → no image created (negative)', async () => {
    mockUpload.mockReturnValue({ promise: Promise.resolve({ kind: 'ok', assetKey: 'x/y' }), abort: vi.fn() });

    render(
      <TestHarness
        doc={doc}
        connection="connected"
        onShowToast={(m) => toasts.push(m)}
        getViewCentre={() => ({ x: 400, y: 300 })}
        onHook={(h) => { hookResult = h; }}
      />,
    );

    // Simulate paste targeting a textarea (text editing context)
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    const pasteEvent = new Event('paste') as any;
    Object.defineProperty(pasteEvent, 'target', { value: textarea });
    pasteEvent.preventDefault = vi.fn();
    pasteEvent.clipboardData = { files: [makeFile('img.png', 'image/png')], types: ['Files'] };

    hookResult.onPaste(pasteEvent);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    let imageCount = 0;
    for (const obj of objects.values()) {
      if (obj.get('type') === 'image') imageCount++;
    }
    expect(imageCount).toBe(0); // no image added while editing text
    document.body.removeChild(textarea);
  });

  it('paste while board focused → image created centred in view', async () => {
    mockUpload.mockReturnValue({ promise: Promise.resolve({ kind: 'ok', assetKey: 'x/y' }), abort: vi.fn() });

    render(
      <TestHarness
        doc={doc}
        connection="connected"
        onShowToast={(m) => toasts.push(m)}
        getViewCentre={() => ({ x: 400, y: 300 })}
        onHook={(h) => { hookResult = h; }}
      />,
    );

    const pasteEvent = new Event('paste') as any;
    Object.defineProperty(pasteEvent, 'target', { value: document.body });
    pasteEvent.preventDefault = vi.fn();
    pasteEvent.clipboardData = { files: [makeFile('img.png', 'image/png')], types: ['Files'] };

    await act(async () => {
      hookResult.onPaste(pasteEvent);
    });

    await waitFor(() => {
      const objects = doc.getMap<Y.Map<unknown>>('objects');
      let imageCount = 0;
      for (const obj of objects.values()) {
        if (obj.get('type') === 'image') imageCount++;
      }
      expect(imageCount).toBe(1);
    });
  });
});

describe('useImageInsert offline (TC-19)', () => {
  let doc: Y.Doc;
  let toasts: string[];
  let hookResult: any;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    toasts = [];
    hookResult = null;
    mockUpload.mockReset();
    (globalThis as any).createImageBitmap = vi.fn().mockResolvedValue({
      width: 100,
      height: 100,
      close: vi.fn(),
    });
  });

  it('reconnecting state → drop shows offline toast; no objects; upload not called', async () => {
    render(
      <TestHarness
        doc={doc}
        connection="reconnecting"
        onShowToast={(m) => toasts.push(m)}
        getViewCentre={() => ({ x: 400, y: 300 })}
        onHook={(h) => { hookResult = h; }}
      />,
    );

    const dropEvent = new Event('drop') as any;
    dropEvent.preventDefault = vi.fn();
    dropEvent.dataTransfer = { files: [makeFile('img.png', 'image/png')], types: ['Files'] };
    dropEvent.offsetX = 100;
    dropEvent.offsetY = 100;

    hookResult.onDrop(dropEvent);
    await act(async () => { await new Promise(r => setTimeout(r, 10)); });

    expect(toasts).toContain("You're offline — images can be added when you reconnect.");
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    let imageCount = 0;
    for (const obj of objects.values()) {
      if (obj.get('type') === 'image') imageCount++;
    }
    expect(imageCount).toBe(0);
    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('useImageInsert decode failure (TC-29)', () => {
  let doc: Y.Doc;
  let toasts: string[];
  let hookResult: any;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    toasts = [];
    hookResult = null;
    mockUpload.mockReset();
  });

  it('createImageBitmap rejects for corrupt file → type toast, no placeholder', async () => {
    (globalThis as any).createImageBitmap = vi.fn().mockRejectedValue(new Error('decode failed'));

    render(
      <TestHarness
        doc={doc}
        connection="connected"
        onShowToast={(m) => toasts.push(m)}
        getViewCentre={() => ({ x: 400, y: 300 })}
        onHook={(h) => { hookResult = h; }}
      />,
    );

    const dropEvent = new Event('drop') as any;
    dropEvent.preventDefault = vi.fn();
    dropEvent.dataTransfer = { files: [makeFile('corrupt.png', 'image/png')], types: ['Files'] };
    dropEvent.offsetX = 100;
    dropEvent.offsetY = 100;

    await act(async () => {
      hookResult.onDrop(dropEvent);
    });

    await act(async () => { await new Promise(r => setTimeout(r, 50)); });

    expect(toasts).toContain('Only PNG, JPEG, GIF and WebP images can be added.');
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    let imageCount = 0;
    for (const obj of objects.values()) {
      if (obj.get('type') === 'image') imageCount++;
    }
    expect(imageCount).toBe(0);
  });
});
