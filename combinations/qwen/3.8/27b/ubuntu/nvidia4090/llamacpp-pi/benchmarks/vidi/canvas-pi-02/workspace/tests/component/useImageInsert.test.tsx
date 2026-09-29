/**
 * TC-17: a drop of three valid files creates three uploading placeholders.
 * TC-18: a paste of one image file creates one placeholder centred in view.
 * TC-19: offline, a drop shows the offline toast and creates nothing.
 * TC-20: a drop creates an object (file stored for retry).
 * TC-29: focus in a text input: paste is ignored.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import * as Y from 'yjs';

// Mock uploadImage to prevent real XHR (which would fail and flip status to 'failed').
vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn(() => ({
    // A never-resolving promise keeps the status as 'uploading'.
    promise: new Promise<never>(() => {}),
    cancel: vi.fn(),
  })),
}));

import { useImageInsert } from '../../src/client/images/useImageInsert';
import type { DragEventLike, PasteEventLike } from '../../src/client/images/useImageInsert';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import type { Camera, Size } from '../../src/client/canvas/camera';

const SIZE: Size = { width: 1280, height: 800 };
const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

afterEach(() => { vi.unstubAllGlobals(); });

function makeFile(name: string, type: string, size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

function dragEvent(files: File[]): DragEventLike {
  return {
    clientX: 100, clientY: 200, preventDefault: vi.fn(),
    dataTransfer: {
      files: files as unknown as FileList,
      items: files.map(f => ({ kind: 'file' as const, type: f.type, getAsFile: () => f })) as unknown as DataTransferItemList,
      types: ['Files'],
      setData: vi.fn(), getData: vi.fn(), clearData: vi.fn(), setDragImage: vi.fn(),
    } as unknown as DataTransfer,
  };
}

function pasteEvent(files: File[]): PasteEventLike {
  return {
    clipboardData: {
      items: files.map(f => ({ kind: 'file' as const, type: f.type, getAsFile: () => f })) as unknown as DataTransferItemList,
      files: files as unknown as FileList,
      types: ['Files'],
    } as unknown as DataTransfer,
    preventDefault: vi.fn(),
  };
}

function countImages(doc: Y.Doc, status?: string): number {
  const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
  let n = 0;
  objects.forEach((obj) => {
    if (obj.get('type') === 'image') {
      if (!status || obj.get('imageStatus') === status) n++;
    }
  });
  return n;
}

async function wait(ms: number): Promise<void> {
  await new Promise(r => setTimeout(r, ms));
}

// --- TC-17 -----------------------------------------------------------------------

describe('TC-17: drop of three files creates three placeholders', () => {
  it('creates three uploading objects', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 800, height: 600, close: vi.fn() }));
    const doc = new Y.Doc();
    let onDrop: (e: DragEventLike) => void;

    function T() {
      const r = useImageInsert({ doc, boardId: 'b1', camera: CAMERA, size: SIZE, connection: 'connected', identityId: 'u1', showToast: () => {} });
      onDrop = r.onDrop;
      return null;
    }
    render(<T />);
    await act(async () => { await wait(10); });

    const files = [makeFile('a.png', 'image/png'), makeFile('b.jpg', 'image/jpeg'), makeFile('c.gif', 'image/gif')];
    act(() => { onDrop(dragEvent(files)); });
    await wait(200);

    expect(countImages(doc, 'uploading')).toBe(3);
  });
});

// --- TC-18 -----------------------------------------------------------------------

describe('TC-18: paste of one image creates one placeholder', () => {
  it('creates one uploading object centred in view', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 400, height: 300, close: vi.fn() }));
    const doc = new Y.Doc();
    let onPaste: (e: PasteEventLike) => void;

    function T() {
      const r = useImageInsert({ doc, boardId: 'b1', camera: CAMERA, size: SIZE, connection: 'connected', identityId: 'u1', showToast: () => {} });
      onPaste = r.onPaste;
      return null;
    }
    render(<T />);
    await act(async () => { await wait(10); });

    const file = makeFile('pasted.png', 'image/png');
    act(() => { onPaste(pasteEvent([file])); });
    await wait(200);

    expect(countImages(doc, 'uploading')).toBe(1);
    // Horizontally centred: world x = 640 - 400/2 = 440; y = 400 (row starts at centre y)
    const objects = doc.getMap('objects') as Y.Map<Y.Map<unknown>>;
    objects.forEach((obj) => {
      if (obj.get('type') === 'image') {
        expect(obj.get('x')).toBe(440);
        expect(obj.get('y')).toBe(400);
      }
    });
  });
});

// --- TC-19 -----------------------------------------------------------------------

describe('TC-19: offline drop shows toast, creates nothing', () => {
  it('shows offline toast and creates no objects', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 400, height: 300, close: vi.fn() }));
    const doc = new Y.Doc();
    const toasts: string[] = [];
    let onDrop: (e: DragEventLike) => void;

    function T() {
      const r = useImageInsert({ doc, boardId: 'b1', camera: CAMERA, size: SIZE, connection: 'reconnecting', identityId: 'u1', showToast: (m: string) => toasts.push(m) });
      onDrop = r.onDrop;
      return null;
    }
    render(<T />);
    await act(async () => { await wait(10); });

    act(() => { onDrop(dragEvent([makeFile('off.png', 'image/png')])); });
    await wait(100);

    expect(toasts).toContain(REJECTION_MESSAGES.offline);
    expect(countImages(doc)).toBe(0);
  });
});

// --- TC-20 -----------------------------------------------------------------------

describe('TC-20: drop creates an object (file stored for retry)', () => {
  it('creates an uploading object on drop', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 400, height: 300, close: vi.fn() }));
    const doc = new Y.Doc();
    let onDrop: (e: DragEventLike) => void;

    function T() {
      const r = useImageInsert({ doc, boardId: 'b1', camera: CAMERA, size: SIZE, connection: 'connected', identityId: 'u1', showToast: () => {} });
      onDrop = r.onDrop;
      return null;
    }
    render(<T />);
    await act(async () => { await wait(10); });

    act(() => { onDrop(dragEvent([makeFile('r.png', 'image/png')])); });
    await wait(200);

    expect(countImages(doc, 'uploading')).toBe(1);
  });
});

// --- TC-29 -----------------------------------------------------------------------

describe('TC-29: paste in text input is ignored', () => {
  it('does not create an object when focus is in a textarea', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 400, height: 300, close: vi.fn() }));
    const doc = new Y.Doc();
    let onPaste: (e: PasteEventLike) => void;

    function T() {
      const r = useImageInsert({ doc, boardId: 'b1', camera: CAMERA, size: SIZE, connection: 'connected', identityId: 'u1', showToast: () => {} });
      onPaste = r.onPaste;
      return (
        <>
          <div data-testid="harness" />
          <textarea data-testid="ta" />
        </>
      );
    }
    const { container } = render(<T />);
    const ta = container.querySelector('[data-testid="ta"]') as HTMLTextAreaElement;
    ta.focus();
    await act(async () => { await wait(10); });

    act(() => { onPaste(pasteEvent([makeFile('in-ta.png', 'image/png')])); });
    await wait(200);

    expect(countImages(doc)).toBe(0);
  });
});
