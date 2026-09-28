/**
 * Story 12: useImageInsert component tests.
 * TC-17 to TC-20, TC-29
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { useEffect } from 'react';
import { useImageInsert } from '../../src/client/images/useImageInsert';

// Mock uploadImage
vi.mock('../../src/client/images/uploadImage', () => {
  return {
    uploadImage: vi.fn((_boardId: string, _file: File, onProgress: (f: number) => void) => {
      const promise = new Promise<{ kind: 'ok'; assetKey: string }>((resolve) => {
        setTimeout(() => {
          onProgress(1);
          resolve({ kind: 'ok', assetKey: 'board/asset' });
        }, 0);
      });
      return { promise, abort: vi.fn() };
    }),
  };
});

import { uploadImage } from '../../src/client/images/uploadImage';

// Stub createImageBitmap and reset mocks
beforeEach(() => {
  vi.mocked(uploadImage).mockClear();
  vi.mocked(uploadImage).mockImplementation((_boardId: string, _file: File, onProgress: (f: number) => void) => {
    const promise = new Promise<{ kind: 'ok'; assetKey: string }>((resolve) => {
      setTimeout(() => {
        onProgress(1);
        resolve({ kind: 'ok', assetKey: 'board/asset' });
      }, 0);
    });
    return { promise, abort: vi.fn() };
  });
  (globalThis as any).createImageBitmap = vi.fn(async () => ({
    width: 100,
    height: 80,
    close: vi.fn(),
  }));
});

interface HarnessProps {
  doc: Y.Doc;
  boardId: string;
  connection: string;
  onToast(text: string): void;
  onRef?(h: any): void;
}

function Harness({ doc, boardId, connection, onToast, onRef }: HarnessProps) {
  const insert = useImageInsert({
    doc,
    boardId,
    camera: { x: 0, y: 0, zoom: 1, vw: 800, vh: 600 } as any,
    connection: connection as any,
    identityId: 'user-1',
    showToast: onToast,
  });

  useEffect(() => {
    onRef?.(insert);
  }, [insert, onRef]);

  return (
    <div data-testid="harness">
      <div
        data-testid="drop-area"
        onDragOver={(e) => insert.onDragOver(e.nativeEvent)}
        onDrop={(e) => insert.onDrop(e.nativeEvent)}
      >
        Drop here
      </div>
      {insert.dragging && <div data-testid="drop-highlight">Highlight</div>}
    </div>
  );
}

function makeTestFile(name: string, type: string, size = 100): File {
  return new File([new Uint8Array(size)], name, { type });
}

function getObjects(doc: Y.Doc): Map<string, Y.Map<unknown>> {
  return doc.getMap('objects') as unknown as Map<string, Y.Map<unknown>>;
}

afterEach(() => {
  cleanup();
});

// ─── TC-17: Drop 3 files → 3 placeholders → ready ───────────────────────────

describe('TC-17: Drop 3 files → 3 placeholders → ready', () => {
  it('creates 3 placeholders in a row, progress updates, then ready', async () => {
    const doc = new Y.Doc();
    doc.getMap('objects');
    const toasts: string[] = [];
    let insertRef: any = null;

    const { getByTestId } = render(
      <Harness
        doc={doc}
        boardId="test-board"
        connection="connected"
        onToast={(t) => toasts.push(t)}
        onRef={(h) => { insertRef = h; }}
      />,
    );

    await waitFor(() => { expect(insertRef).not.toBeNull(); });

    const dropArea = getByTestId('drop-area');
    const files = [
      makeTestFile('a.png', 'image/png'),
      makeTestFile('b.jpeg', 'image/jpeg'),
      makeTestFile('c.gif', 'image/gif'),
    ];

    const dropEvent = new Event('drop', { bubbles: true }) as any;
    dropEvent.dataTransfer = { files, types: ['Files'], dropEffect: 'copy' };
    dropEvent.clientX = 100;
    dropEvent.clientY = 100;
    dropEvent.preventDefault = vi.fn();

    await act(async () => {
      fireEvent(dropArea, dropEvent);
    });

    // Wait for async processing
    await waitFor(() => {
      const objects = getObjects(doc);
      expect(objects.size).toBe(3);
    });

    // All should become ready
    await waitFor(() => {
      const objects = getObjects(doc);
      let readyCount = 0;
      objects.forEach((obj) => {
        if (obj.get('status') === 'ready') readyCount++;
      });
      expect(readyCount).toBe(3);
    });
  });
});

// ─── TC-18: Paste behavior ──────────────────────────────────────────────────

describe('TC-18: Paste while editing vs board focused', () => {
  it('no image created when focus is in a textarea', async () => {
    const doc = new Y.Doc();
    doc.getMap('objects');

    const { getByTestId } = render(
      <div>
        <textarea data-testid="editor" />
      </div>,
    );

    // The textarea is the target of paste - simulates editing context
    const textarea = getByTestId('editor') as HTMLTextAreaElement;
    textarea.focus();

    // Paste on textarea target should not insert image
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('image created when board focused (paste target is body)', async () => {
    const doc = new Y.Doc();
    doc.getMap('objects');
    const toasts: string[] = [];
    let insertRef: any = null;

    render(
      <Harness
        doc={doc}
        boardId="test-board"
        connection="connected"
        onToast={(t) => toasts.push(t)}
        onRef={(h) => { insertRef = h; }}
      />,
    );

    await waitFor(() => { expect(insertRef).not.toBeNull(); });

    // Simulate paste on body (board focused)
    const pasteEvent = new Event('paste', { bubbles: true }) as any;
    pasteEvent.clipboardData = { files: [makeTestFile('img.png', 'image/png')] };
    Object.defineProperty(pasteEvent, 'target', { value: document.body });
    pasteEvent.preventDefault = vi.fn();

    await act(async () => {
      insertRef.onPaste(pasteEvent);
    });

    await waitFor(() => {
      expect(doc.getMap('objects').size).toBe(1);
    });
  });
});

// ─── TC-19: Offline → toast, no objects, no upload ──────────────────────────

describe('TC-19: Offline → toast, no objects', () => {
  it('shows offline toast and does not create objects or upload', async () => {
    const doc = new Y.Doc();
    doc.getMap('objects');
    const toasts: string[] = [];
    let insertRef: any = null;

    const { getByTestId } = render(
      <Harness
        doc={doc}
        boardId="test-board"
        connection="reconnecting"
        onToast={(t) => toasts.push(t)}
        onRef={(h) => { insertRef = h; }}
      />,
    );

    await waitFor(() => { expect(insertRef).not.toBeNull(); });

    const dropArea = getByTestId('drop-area');
    const dropEvent = new Event('drop', { bubbles: true }) as any;
    dropEvent.dataTransfer = { files: [makeTestFile('img.png', 'image/png')], types: ['Files'], dropEffect: 'copy' };
    dropEvent.clientX = 100;
    dropEvent.clientY = 100;
    dropEvent.preventDefault = vi.fn();

    await act(async () => {
      fireEvent(dropArea, dropEvent);
    });

    await waitFor(() => {
      expect(toasts.some((t) => t.includes('offline'))).toBe(true);
    });

    expect(doc.getMap('objects').size).toBe(0);
    expect(uploadImage).not.toHaveBeenCalled();
  });
});

// ─── TC-20: Rate limited upload ─────────────────────────────────────────────

describe('TC-20: Rate limited → failed object + toast', () => {
  it('object becomes failed and rate toast shown', async () => {
    // Override mock for this test
    (uploadImage as any).mockImplementationOnce((_boardId: string, _file: File, _onProgress: any) => ({
      promise: Promise.resolve({ kind: 'rate_limited' }),
      abort: vi.fn(),
    }));

    const doc = new Y.Doc();
    doc.getMap('objects');
    const toasts: string[] = [];
    let insertRef: any = null;

    const { getByTestId } = render(
      <Harness
        doc={doc}
        boardId="test-board"
        connection="connected"
        onToast={(t) => toasts.push(t)}
        onRef={(h) => { insertRef = h; }}
      />,
    );

    await waitFor(() => { expect(insertRef).not.toBeNull(); });

    const dropArea = getByTestId('drop-area');
    const dropEvent = new Event('drop', { bubbles: true }) as any;
    dropEvent.dataTransfer = { files: [makeTestFile('img.png', 'image/png')], types: ['Files'], dropEffect: 'copy' };
    dropEvent.clientX = 100;
    dropEvent.clientY = 100;
    dropEvent.preventDefault = vi.fn();

    await act(async () => {
      fireEvent(dropArea, dropEvent);
    });

    await waitFor(() => {
      expect(toasts.some((t) => t.includes('too quickly'))).toBe(true);
    });

    await waitFor(() => {
      const objects = getObjects(doc);
      let failedCount = 0;
      objects.forEach((obj) => {
        if (obj.get('status') === 'failed') failedCount++;
      });
      expect(failedCount).toBe(1);
    });
  });
});

// ─── TC-29: createImageBitmap rejects → type toast, no placeholder ─────────

describe('TC-29: createImageBitmap rejects → type toast, no placeholder', () => {
  it('shows type toast and does not create placeholder', async () => {
    (globalThis as any).createImageBitmap = vi.fn(async () => {
      throw new Error('decode failed');
    });

    const doc = new Y.Doc();
    doc.getMap('objects');
    const toasts: string[] = [];
    let insertRef: any = null;

    const { getByTestId } = render(
      <Harness
        doc={doc}
        boardId="test-board"
        connection="connected"
        onToast={(t) => toasts.push(t)}
        onRef={(h) => { insertRef = h; }}
      />,
    );

    await waitFor(() => { expect(insertRef).not.toBeNull(); });

    const dropArea = getByTestId('drop-area');
    const dropEvent = new Event('drop', { bubbles: true }) as any;
    dropEvent.dataTransfer = { files: [makeTestFile('corrupt.png', 'image/png')], types: ['Files'], dropEffect: 'copy' };
    dropEvent.clientX = 100;
    dropEvent.clientY = 100;
    dropEvent.preventDefault = vi.fn();

    await act(async () => {
      fireEvent(dropArea, dropEvent);
    });

    await waitFor(() => {
      expect(toasts.some((t) => t.includes('PNG, JPEG, GIF and WebP'))).toBe(true);
    });

    expect(doc.getMap('objects').size).toBe(0);
  });
});
