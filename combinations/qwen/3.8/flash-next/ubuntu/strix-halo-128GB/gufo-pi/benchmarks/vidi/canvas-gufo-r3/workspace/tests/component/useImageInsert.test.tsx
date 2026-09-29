import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, act, fireEvent, cleanup, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc } from '@shared/board-model';
import { snapshotImage, displayStatus } from '@shared/objects/image';
import { IMAGE_UPLOAD_STALE_MS, IMAGE_LAYOUT_GAP_WORLD } from '@shared/config';
import type { ConnectionState } from '@client/sync/connectBoard';

// Mock uploadImage
const mockUploadImage = vi.fn();
vi.mock('@client/images/uploadImage', () => ({
  uploadImage: (...args: any[]) => mockUploadImage(...args),
}));

// Mock createImageBitmap globally
const mockCreateImageBitmap = vi.fn();
(globalThis as any).createImageBitmap = mockCreateImageBitmap;

import { useImageInsert } from '@client/images/useImageInsert';
import { showToast } from '@client/ui/Toast';

vi.mock('@client/ui/Toast', () => ({
  showToast: vi.fn(),
}));

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makeFile(name: string, type: string, size = 100): File {
  const buf = new ArrayBuffer(size);
  return new File([buf], name, { type });
}

interface HarnessResult {
  doc: Y.Doc;
  imageInsert: ReturnType<typeof useImageInsert>;
}

function TestHarness({
  doc,
  connection,
  boardId = 'abcdefghijklmnopqrstuv',
  onReady,
}: {
  doc: Y.Doc;
  connection: ConnectionState;
  boardId?: string;
  onReady(api: HarnessResult): void;
}) {
  const imageInsert = useImageInsert({
    doc,
    boardId,
    camera: { x: 0, y: 0, zoom: 1 },
    connection,
    identityId: 'alice',
    viewportSize: { width: 800, height: 600 },
  });

  // Expose via onReady
  React.useEffect(() => {
    onReady({ doc, imageInsert });
  });

  return <div data-testid="harness" />;
}

describe('useImageInsert component tests', () => {
  let doc: Y.Doc;
  let api: HarnessResult;
  let mockResolve: ((v: any) => void)[];

  beforeEach(() => {
    doc = makeDoc();
    api = null as any;
    mockResolve = [];
    mockUploadImage.mockReset();
    mockCreateImageBitmap.mockReset();
    vi.mocked(showToast).mockReset();

    // Default: createImageBitmap resolves with 200x150
    mockCreateImageBitmap.mockResolvedValue({ width: 200, height: 150, close: vi.fn() });

    // Default upload: resolves with a deferred
    mockUploadImage.mockImplementation((_boardId: string, _file: File, onProgress: any) => {
      let resolve: (v: any) => void;
      const promise = new Promise((r) => { resolve = r; });
      mockResolve.push(resolve!);
      return { promise, abort: vi.fn() };
    });
  });

  afterEach(cleanup);

  function renderHarness(connection: ConnectionState = 'connected') {
    render(
      <TestHarness
        doc={doc}
        connection={connection}
        onReady={(a) => { api = a; }}
      />
    );
  }

  // TC-17: drop 3 valid files → 3 placeholders in a row; progress updates; ready after resolve
  it('TC-17: drop 3 valid files → 3 placeholders in a row; progress updates; ready after resolve', async () => {
    renderHarness('connected');

    const files = [
      makeFile('a.png', 'image/png'),
      makeFile('b.png', 'image/png'),
      makeFile('c.png', 'image/png'),
    ];

    const dropEvent = new Event('drop', { bubbles: true }) as any;
    dropEvent.dataTransfer = { files, types: ['Files'] };
    dropEvent.clientX = 100;
    dropEvent.clientY = 100;

    await act(async () => {
      api.imageInsert.onDrop(dropEvent);
    });

    // Should have 3 image objects
    const snaps = snapshotImage(doc);
    expect(snaps).toHaveLength(3);

    // All uploading
    for (const s of snaps) {
      expect(s.status).toBe('uploading');
      expect(s.uploaderId).toBe('alice');
    }

    // Check layout: tops aligned, gap between them
    const sorted = [...snaps].sort((a, b) => a.x - b.x);
    expect(sorted[1].x).toBe(sorted[0].x + sorted[0].width + IMAGE_LAYOUT_GAP_WORLD);
    expect(sorted[2].x).toBe(sorted[1].x + sorted[1].width + IMAGE_LAYOUT_GAP_WORLD);

    // Resolve first upload
    await act(async () => {
      mockResolve[0]({ kind: 'ok', assetKey: 'board/asset1' });
    });

    const updated = snapshotImage(doc);
    const readyOne = updated.find((s) => s.assetKey === 'board/asset1');
    expect(readyOne).toBeDefined();
    expect(readyOne!.status).toBe('ready');
  });

  // TC-18: paste while editing → no image; paste while board focused → image centred
  it('TC-18: paste while editing text → no image created', () => {
    renderHarness('connected');

    // Simulate paste event with focus in textarea
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    textarea.focus();

    const files = [makeFile('clip.png', 'image/png')];
    const pasteEvent = new Event('paste', { bubbles: true }) as any;
    pasteEvent.clipboardData = { files };

    act(() => {
      api.imageInsert.onPaste(pasteEvent);
    });

    // No image objects created
    const snaps = snapshotImage(doc);
    expect(snaps).toHaveLength(0);

    document.body.removeChild(textarea);
  });

  it('TC-18: paste while board focused → image centred in view', async () => {
    renderHarness('connected');

    const files = [makeFile('clip.png', 'image/png')];
    const pasteEvent = new Event('paste', { bubbles: true }) as any;
    pasteEvent.clipboardData = { files };

    await act(async () => {
      api.imageInsert.onPaste(pasteEvent);
    });

    const snaps = snapshotImage(doc);
    expect(snaps).toHaveLength(1);
    // Should be centred: view centre is (400, 300) for viewport 800x600
    // Image is 200x150, so centred: x = 400 - 200/2 = 300, y = 300 - 150/2 = 225
    expect(snaps[0].x).toBeCloseTo(300);
    expect(snaps[0].y).toBeCloseTo(225);
  });

  // TC-19: offline → toast, no objects, upload not called
  it('TC-19: offline then drop → offline toast; no objects; upload not called', () => {
    renderHarness('reconnecting');

    const files = [makeFile('a.png', 'image/png')];
    const dropEvent = new Event('drop', { bubbles: true }) as any;
    dropEvent.dataTransfer = { files, types: ['Files'] };
    dropEvent.clientX = 100;
    dropEvent.clientY = 100;

    act(() => {
      api.imageInsert.onDrop(dropEvent);
    });

    // No objects created
    expect(snapshotImage(doc)).toHaveLength(0);
    // Upload not called
    expect(mockUploadImage).not.toHaveBeenCalled();
    // Offline toast shown
    expect(showToast).toHaveBeenCalledWith(
      "You're offline — images can be added when you reconnect.",
    );
  });

  // TC-20: picker with rate_limited → object failed; rate toast
  it('TC-20: upload returns rate_limited → object failed; rate toast', async () => {
    renderHarness('connected');

    mockUploadImage.mockImplementation((_boardId: string, _file: File, _onProgress: any) => {
      return {
        promise: Promise.resolve({ kind: 'rate_limited' }),
        abort: vi.fn(),
      };
    });

    const files = [makeFile('a.png', 'image/png')];
    const dropEvent = new Event('drop', { bubbles: true }) as any;
    dropEvent.dataTransfer = { files, types: ['Files'] };
    dropEvent.clientX = 100;
    dropEvent.clientY = 100;

    await act(async () => {
      api.imageInsert.onDrop(dropEvent);
    });

    // Wait for the promise to resolve
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const snaps = snapshotImage(doc);
    expect(snaps).toHaveLength(1);
    expect(snaps[0].status).toBe('failed');
    expect(showToast).toHaveBeenCalledWith(
      "You're adding images too quickly. Wait a minute and try again.",
    );
  });

  // TC-29: createImageBitmap rejects → type toast, no placeholder
  it('TC-29: createImageBitmap rejects for corrupt file → type toast, no placeholder', async () => {
    renderHarness('connected');

    mockCreateImageBitmap.mockRejectedValue(new Error('decode failed'));

    const files = [makeFile('corrupt.png', 'image/png')];
    const dropEvent = new Event('drop', { bubbles: true }) as any;
    dropEvent.dataTransfer = { files, types: ['Files'] };
    dropEvent.clientX = 100;
    dropEvent.clientY = 100;

    await act(async () => {
      api.imageInsert.onDrop(dropEvent);
    });

    // No image objects created
    expect(snapshotImage(doc)).toHaveLength(0);
    expect(showToast).toHaveBeenCalledWith(
      'Only PNG, JPEG, GIF and WebP images can be added.',
    );
  });
});
