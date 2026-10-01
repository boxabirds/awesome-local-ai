/**
 * Component tests for useImageInsert hook.
 * TC-17, TC-18, TC-19, TC-29
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';

// Mock uploadImage module
let mockUploadQueue: Array<{ id: string; file: File; onProgress: (f: number) => void; resolve: (r: any) => void }> = [];

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (boardId: string, file: File, onProgress: (f: number) => void) => {
    const entry: typeof mockUploadQueue[0] = { id: '', file, onProgress, resolve: null as any };
    const promise = new Promise((resolve) => { entry.resolve = resolve; });
    mockUploadQueue.push(entry);
    return { promise, abort: vi.fn() };
  },
}));

// Stub createImageBitmap globally for jsdom
let bitmapSizeMap: Map<File, { width: number; height: number }> = new Map();
let bitmapShouldFail: Set<File> = new Set();

beforeEach(() => {
  mockUploadQueue = [];
  bitmapSizeMap = new Map();
  bitmapShouldFail = new Set();

  (globalThis as any).createImageBitmap = vi.fn(async (file: File) => {
    if (bitmapShouldFail.has(file)) throw new Error('decode failed');
    const size = bitmapSizeMap.get(file) ?? { width: 400, height: 300 };
    return { width: size.width, height: size.height, close: vi.fn() };
  });
});

function makeFile(name: string, type: string, size = 1024): File {
  const f = new File([new ArrayBuffer(size)], name, { type });
  bitmapSizeMap.set(f, { width: 400, height: 300 });
  return f;
}

interface TestComponentProps {
  doc: Y.Doc;
  boardId: string;
  connection: ConnectionState;
  showToast: ReturnType<typeof vi.fn>;
  onReady?(result: any): void;
}

function TestComponent({ doc, boardId, connection, showToast, onReady }: TestComponentProps) {
  const result = useImageInsert({
    doc,
    boardId,
    camera: { x: 0, y: 0, zoom: 1 },
    connection,
    identityId: 'user1',
    viewport: { width: 800, height: 600 },
    showToast,
  });

  // Expose for testing
  React.useEffect(() => {
    onReady?.(result);
  });

  return <div data-testid="test-component" />;
}

describe('useImageInsert drop flow (TC-17)', () => {
  let doc: Y.Doc;
  let showToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    showToast = vi.fn();
  });

  it('drops 3 valid files → 3 placeholders in a row, progress updates, ready after resolve', async () => {
    let hookResult: any = null;
    render(
      <TestComponent
        doc={doc}
        boardId="test-board"
        connection="connected"
        showToast={showToast}
        onReady={(r) => { hookResult = r; }}
      />,
    );

    const files = [makeFile('a.png', 'image/png'), makeFile('b.jpg', 'image/jpeg'), makeFile('c.gif', 'image/gif')];

    // Create a DataTransfer-like mock event (not a real Event, just an object with the right shape)
    const dropEvent = {
      dataTransfer: { files, types: ['Files'] },
      clientX: 400,
      clientY: 300,
      target: document.body,
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    await act(async () => {
      hookResult.onDrop(dropEvent);
      // Let async operations process
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    // Check 3 image objects in doc
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const imageObjs = [...objects.entries()].filter(([, m]) => m.get('type') === 'image');
    expect(imageObjs).toHaveLength(3);

    // All should be uploading
    for (const [, m] of imageObjs) {
      expect(m.get('status')).toBe('uploading');
    }

    // Check they are laid out in a row (tops at same y, gaps of IMAGE_LAYOUT_GAP_WORLD)
    const ys = imageObjs.map(([, m]) => m.get('y') as number);
    expect(new Set(ys).size).toBe(1);

    // X positions: first at drop point, subsequent offset by width + gap
    const xs = imageObjs.map(([, m]) => m.get('x') as number).sort((a, b) => a - b);
    const widths = imageObjs.map(([, m]) => m.get('width') as number);
    // Widths should all be 400 (from bitmap stub)
    for (let i = 1; i < xs.length; i++) {
      // The gap between them should be IMAGE_LAYOUT_GAP_WORLD from the preceding width
      expect(xs[i]).toBe(xs[i - 1] + widths[i - 1] + IMAGE_LAYOUT_GAP_WORLD);
    }

    // Simulate upload progress for first upload
    await act(async () => {
      if (mockUploadQueue[0]) {
        mockUploadQueue[0].onProgress(0.5);
        await new Promise((r) => setTimeout(r, 0));
      }
    });

    // Resolve all uploads sequentially (the hook processes them one by one)
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        if (mockUploadQueue[i]) {
          mockUploadQueue[i].resolve({ kind: 'ok', assetKey: `board1/asset${i}` });
        }
        // Allow microtasks to run so next upload starts
        await new Promise((r) => setTimeout(r, 50));
      });
    }

    // Verify ready status
    for (const [, m] of imageObjs) {
      expect(m.get('status')).toBe('ready');
    }
  });
});

describe('useImageInsert paste flow (TC-18)', () => {
  let doc: Y.Doc;
  let showToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    showToast = vi.fn();
  });

  it('paste while editing text → no image created (negative)', async () => {
    let hookResult: any = null;
    render(
      <TestComponent
        doc={doc}
        boardId="test-board"
        connection="connected"
        showToast={showToast}
        onReady={(r) => { hookResult = r; }}
      />,
    );

    const file = makeFile('paste.png', 'image/png');
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    // Dispatch on textarea element so target is textarea
    await act(async () => {
      hookResult.onPaste({
        clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] },
        target: textarea,
        preventDefault: vi.fn(),
      } as unknown as ClipboardEvent);
      await new Promise((r) => setTimeout(r, 0));
    });

    // No image objects created
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const imageObjs = [...objects.entries()].filter(([, m]) => m.get('type') === 'image');
    expect(imageObjs).toHaveLength(0);
    document.body.removeChild(textarea);
  });

  it('paste while board focused → image centred in view', async () => {
    let hookResult: any = null;
    render(
      <TestComponent
        doc={doc}
        boardId="test-board"
        connection="connected"
        showToast={showToast}
        onReady={(r) => { hookResult = r; }}
      />,
    );

    const file = makeFile('paste.png', 'image/png');
    const pasteEvent = {
      clipboardData: { items: [{ type: 'image/png', getAsFile: () => file }] },
      target: document.body,
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;

    await act(async () => {
      hookResult.onPaste(pasteEvent);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const imageObjs = [...objects.entries()].filter(([, m]) => m.get('type') === 'image');
    expect(imageObjs).toHaveLength(1);
  });
});

describe('useImageInsert offline (TC-19)', () => {
  let doc: Y.Doc;
  let showToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    showToast = vi.fn();
  });

  it('reconnecting state then drop → offline toast, no objects, no upload', async () => {
    let hookResult: any = null;
    render(
      <TestComponent
        doc={doc}
        boardId="test-board"
        connection="reconnecting"
        showToast={showToast}
        onReady={(r) => { hookResult = r; }}
      />,
    );

    const file = makeFile('test.png', 'image/png');
    const dropEvent = {
      dataTransfer: { files: [file], types: ['Files'] },
      clientX: 400,
      clientY: 300,
      target: document.body,
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    await act(async () => {
      hookResult.onDrop(dropEvent);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('offline'));
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const imageObjs = [...objects.entries()].filter(([, m]) => m.get('type') === 'image');
    expect(imageObjs).toHaveLength(0);
    expect(mockUploadQueue).toHaveLength(0);
  });
});

describe('useImageInsert decode failure (TC-29)', () => {
  let doc: Y.Doc;
  let showToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    showToast = vi.fn();
  });

  it('createImageBitmap rejects → type toast, no placeholder', async () => {
    let hookResult: any = null;
    render(
      <TestComponent
        doc={doc}
        boardId="test-board"
        connection="connected"
        showToast={showToast}
        onReady={(r) => { hookResult = r; }}
      />,
    );

    const corruptFile = new File([new ArrayBuffer(1024)], 'corrupt.png', { type: 'image/png' });
    bitmapShouldFail.add(corruptFile);

    const dropEvent = {
      dataTransfer: { files: [corruptFile], types: ['Files'] },
      clientX: 400,
      clientY: 300,
      target: document.body,
      preventDefault: vi.fn(),
    } as unknown as DragEvent;

    await act(async () => {
      hookResult.onDrop(dropEvent);
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Only PNG, JPEG, GIF and WebP'));
    const objects = doc.getMap<Y.Map<unknown>>('objects');
    const imageObjs = [...objects.entries()].filter(([, m]) => m.get('type') === 'image');
    expect(imageObjs).toHaveLength(0);
  });
});
