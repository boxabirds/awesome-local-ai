/**
 * Story 12 component tests: useImageInsert flows (TC-17, TC-18, TC-19, TC-29).
 */

import { act, renderHook, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import type { Camera } from '../../src/client/canvas/camera';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import type { ToastState } from '../../src/client/ui/Toast';
import { objectSnapshots } from '../../src/shared/board-model';
import { isImageSnapshot } from '../../src/shared/objects/image';

// vi.hoisted ensures mockUploadImage is initialized before the vi.mock factory runs
const { mockUploadImage } = vi.hoisted(() => ({
  mockUploadImage: vi.fn(),
}));

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: mockUploadImage,
}));

import { useImageInsert } from '../../src/client/images/useImageInsert';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };
const VIEWPORT = { width: 1200, height: 800 };

function makeToast(): ToastState & { shown: string[] } {
  const shown: string[] = [];
  return {
    messages: [],
    show(text: string) {
      shown.push(text);
    },
    shown,
  };
}

function makeFile(name: string, type: string, size = 1000): File {
  const buf = new ArrayBuffer(size);
  return new File([buf], name, { type });
}

function makeDropEvent(files: File[], clientX = 50, clientY = 50) {
  return {
    preventDefault: vi.fn(),
    dataTransfer: { files, types: ['Files'] },
    clientX,
    clientY,
    target: null,
  } as unknown as DragEvent;
}

function makePasteEvent(files: File[], target?: HTMLElement) {
  return {
    preventDefault: vi.fn(),
    clipboardData: {
      items: files.map((f) => ({
        type: f.type,
        getAsFile: () => f,
      })),
    },
    target: target ?? document.body,
  } as unknown as ClipboardEvent;
}

function setup(opts: Partial<{
  connection: ConnectionState;
}> = {}) {
  const doc = new Y.Doc();
  const toast = makeToast();
  const { result } = renderHook(() =>
    useImageInsert({
      doc,
      boardId: 'abcdefghijklmnopqrstuv',
      camera: CAMERA,
      viewport: VIEWPORT,
      connection: opts.connection ?? 'connected',
      identityId: 'user-1',
      toast,
    }),
  );
  return { doc, toast, result };
}

/** Flush all pending microtasks (fake timers are active in component tests). */
async function flushMicrotasks() {
  // Multiple ticks to let chained promises resolve
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 200, height: 150, close: () => {} })));
  mockUploadImage.mockReset();
  mockUploadImage.mockImplementation((_boardId: string, _file: File, onProgress: (f: number) => void) => {
    onProgress(0.5);
    return {
      promise: Promise.resolve({ kind: 'ok' as const, assetKey: 'abcdefghijklmnopqrstuv/ABCDEFGHIJKLMNOPQRSTUV' }),
      abort: () => {},
    };
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TC-17: drop 3 valid files creates 3 placeholders, progress updates, ready after resolve', () => {
  it('creates 3 image objects and marks them ready', async () => {
    const { doc, result } = setup();

    const files = [makeFile('a.png', 'image/png'), makeFile('b.png', 'image/png'), makeFile('c.png', 'image/png')];
    const event = makeDropEvent(files);

    await act(async () => {
      result.current.onDrop(event);
      await flushMicrotasks();
    });

    const images = objectSnapshots(doc).filter(isImageSnapshot);
    expect(images).toHaveLength(3);
    expect(images.every((img) => img.status === 'ready')).toBe(true);
  });
});

describe('TC-18: paste while editing does not add image; paste while board focused does', () => {
  it('paste while focus is in textarea → no image created', () => {
    const { doc, result } = setup();
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    const file = makeFile('paste.png', 'image/png');
    const event = makePasteEvent([file], textarea);

    act(() => {
      result.current.onPaste(event);
    });

    const images = objectSnapshots(doc).filter(isImageSnapshot);
    expect(images).toHaveLength(0);

    document.body.removeChild(textarea);
  });

  it('paste while board focused → image created centred in view', async () => {
    const { doc, result } = setup();

    const file = makeFile('paste.png', 'image/png');
    const event = makePasteEvent([file]);

    await act(async () => {
      result.current.onPaste(event);
      await flushMicrotasks();
    });

    const images = objectSnapshots(doc).filter(isImageSnapshot);
    expect(images).toHaveLength(1);
  });
});

describe('TC-19: offline drop → toast, no objects, no upload', () => {
  it('connection reconnecting then drop → offline toast, no objects created', () => {
    const { doc, toast, result } = setup({ connection: 'reconnecting' });

    const files = [makeFile('a.png', 'image/png')];
    const event = makeDropEvent(files);

    act(() => {
      result.current.onDrop(event);
    });

    expect(toast.shown).toContain("You're offline — images can be added when you reconnect.");
    const images = objectSnapshots(doc).filter(isImageSnapshot);
    expect(images).toHaveLength(0);
    expect(mockUploadImage).not.toHaveBeenCalled();
  });
});

describe('TC-29: createImageBitmap rejects → type toast, no placeholder', () => {
  it('decode failure shows type message and creates nothing', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('decode failed');
    }));

    const { doc, toast, result } = setup();

    const files = [makeFile('corrupt.png', 'image/png')];
    const event = makeDropEvent(files);

    await act(async () => {
      result.current.onDrop(event);
      await flushMicrotasks();
    });

    expect(toast.shown).toContain('Only PNG, JPEG, GIF and WebP images can be added.');
    const images = objectSnapshots(doc).filter(isImageSnapshot);
    expect(images).toHaveLength(0);
  });
});
