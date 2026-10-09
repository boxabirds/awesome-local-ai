/**
 * Story 12 component tests (TC-17 to TC-19, TC-29): the drop / paste /
 * picker flows through the real <Board>, with the upload mocked (controllable
 * progress + settlement) and createImageBitmap stubbed (jsdom has no image
 * decoding).
 *
 * Camera pinned to (0,0,1) so world units equal screen pixels; the jsdom
 * viewport is 1024×768, so the view centre is (512, 384).
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { renderBoard } from './board-harness';

/* ------------------------- module mocks ------------------------- */

const h = vi.hoisted(() => {
  interface UploadControl {
    resolve(key: string): void;
    fail(status?: number): void;
    progress(fraction: number): void;
  }
  const uploads: UploadControl[] = [];
  const uploadImage = vi.fn(
    (_boardId: string, _file: File, onProgress: (f: number) => void) => {
      let settle!: (r: { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number }) => void;
      const promise = new Promise<{ kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number }>(
        (r) => {
          settle = r;
        },
      );
      uploads.push({
        resolve: (key: string) => settle({ kind: 'ok', assetKey: key }),
        fail: (status?: number) => settle({ kind: 'failed', status }),
        progress: (f: number) => onProgress(f),
      });
      return { promise, abort: () => undefined };
    },
  );
  return { uploads, uploadImage };
});

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: h.uploadImage,
}));

// Quiet provider (same pattern as the other board component tests).
vi.mock('../../src/client/sync/connectBoard', () => ({
  connectBoard: (_doc: unknown, _boardId: string, onState: (s: string) => void) => {
    const g = globalThis as Record<string, unknown>;
    g.__vidi6_conn_handler = onState;
    onState((g.__vidi6_conn_state as string | undefined) ?? 'connected');
    return {
      destroy() {
        if (g.__vidi6_conn_handler === onState) delete g.__vidi6_conn_handler;
      },
    };
  },
}));

/* ---------------------- jsdom capability stubs ---------------------- */

const bitmap = vi.hoisted(() => {
  const dims = new Map<string, [number, number]>();
  const reject = new Set<string>();
  const createImageBitmap = vi.fn(async (file: File) => {
    if (reject.has(file.name)) throw new Error('decode failed');
    const [w, ht] = dims.get(file.name) ?? [100, 50];
    return { width: w, height: ht, close: () => undefined };
  });
  return { dims, reject, createImageBitmap };
});

beforeEach(() => {
  bitmap.dims.clear();
  bitmap.reject.clear();
  h.uploads.length = 0;
  h.uploadImage.mockClear();
  (globalThis as Record<string, unknown>).createImageBitmap = bitmap.createImageBitmap;
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__vidi6_conn_state;
  delete (globalThis as Record<string, unknown>).__vidi6_conn_handler;
  delete (globalThis as Record<string, unknown>).createImageBitmap;
  cleanup();
});

/* ------------------------------ helpers ------------------------------ */

interface ImageRef {
  id: string;
  map: Y.Map<unknown>;
}

/** Images in the doc (ids are the objects-map keys, the codebase convention). */
function images(): ImageRef[] {
  const out: ImageRef[] = [];
  board.doc.getMap('objects').forEach((v, key) => {
    if (v instanceof Y.Map && v.get('type') === 'image') out.push({ id: String(key), map: v });
  });
  return out;
}

function imgField(id: string, field: string): unknown {
  return (board.doc.getMap('objects').get(id) as Y.Map<unknown>).get(field);
}

let board: ReturnType<typeof renderBoard>;

async function mount(conn: string = 'connected') {
  (globalThis as Record<string, unknown>).__vidi6_conn_state = conn;
  board = renderBoard();
  board.setCamera(0, 0, 1);
}

function file(name: string, type: string): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

/** Synthetic drag event (jsdom has no DataTransfer): duck-typed dataTransfer. */
function makeDrag(type: string, files: File[], x: number, y: number): DragEvent {
  const ev = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
  Object.defineProperty(ev, 'dataTransfer', {
    value: { files, types: ['Files'], dropEffect: 'none' },
  });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  return ev;
}

function makePaste(files: File[]): ClipboardEvent {
  const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(ev, 'clipboardData', {
    value: { files, getData: () => '' },
  });
  return ev;
}

const root = () => board.container.querySelector('.app') as HTMLElement;

async function drop(files: File[], x: number, y: number) {
  act(() => {
    root().dispatchEvent(makeDrag('dragenter', files, x, y));
  });
  act(() => {
    root().dispatchEvent(makeDrag('dragover', files, x, y));
  });
  await act(async () => {
    root().dispatchEvent(makeDrag('drop', files, x, y));
  });
}

/* ------------------------------- tests ------------------------------- */

describe('image.insert (TC-17, TC-18, TC-19, TC-29)', () => {
  it('TC-17: drop 3 files → a row of 3 placeholders with progress, then all ready', async () => {
    await mount();
    bitmap.dims.set('a.png', [100, 50]);
    bitmap.dims.set('b.jpg', [200, 100]);
    bitmap.dims.set('c.gif', [40, 40]);
    const files = [file('a.png', 'image/png'), file('b.jpg', 'image/jpeg'), file('c.gif', 'image/gif')];

    // The drop highlight is visible while files are dragged over the board.
    act(() => root().dispatchEvent(makeDrag('dragenter', files, 100, 100)));
    expect(board.container.querySelector('[data-drop-highlight]')).toBeTruthy();

    await drop(files, 100, 100);
    expect(board.container.querySelector('[data-drop-highlight]')).toBeNull();

    expect(h.uploadImage).toHaveBeenCalledTimes(3);
    const ids = images().map((v) => v.id);
    expect(ids).toHaveLength(3);
    // Row layout from the drop point (top-left): tops aligned, 24-unit gaps.
    expect(imgField(ids[0], 'x')).toBe(100);
    expect(imgField(ids[0], 'y')).toBe(100);
    expect(imgField(ids[1], 'x')).toBe(100 + 100 + 24);
    expect(imgField(ids[1], 'y')).toBe(100);
    expect(imgField(ids[2], 'x')).toBe(100 + 100 + 24 + 200 + 24);
    // Every placeholder is uploading with the uploader's identity + start clock.
    for (const id of ids) {
      expect(imgField(id, 'status')).toBe('uploading');
      expect(typeof imgField(id, 'uploaderId')).toBe('string');
      expect(typeof imgField(id, 'uploadStartedAt')).toBe('number');
    }
    // The uploader sees the percentage progress.
    expect(screen.getAllByText('Uploading 0%')).toHaveLength(3);
    await act(async () => {
      h.uploads[0].progress(0.5);
    });
    expect(screen.getByText('Uploading 50%')).toBeTruthy();
    await act(async () => {
      h.uploads[1].progress(0.75);
    });
    expect(screen.getByText('Uploading 75%')).toBeTruthy();

    // Settle all uploads: ready + assetKey, <img> replaces the placeholder.
    await act(async () => {
      h.uploads.forEach((u, i) => u.resolve(`bbbbbbbbbbbbbbbbbbbbbb/a${'b'.repeat(21 - i)}`));
    });
    for (const id of ids) {
      expect(imgField(id, 'status')).toBe('ready');
      expect(String(imgField(id, 'assetKey') ?? '').startsWith('bbbbbbbbbbbbbbbbbbbbbb/'));
    }
    await waitFor(() => expect(board.container.querySelectorAll('img[data-image-ready]')).toHaveLength(3));
  });

  it('TC-18: paste while editing a note adds nothing; paste on the board adds centred', async () => {
    await mount();
    const png = file('shot.png', 'image/png');

    // A sticky, then enter its text editing (double-click).
    fireEvent.keyDown(window, { key: 'n' });
    await waitFor(() => expect(board.container.querySelector('[data-note-id]')).toBeTruthy());
    const note = board.container.querySelector('[data-note-id]') as HTMLElement;
    fireEvent.dblClick(note);
    const textarea = board.container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).toBeTruthy();

    // Paste targeting the editor: left to the editor, no image added.
    await act(async () => {
      textarea.dispatchEvent(makePaste([png]));
    });
    expect(images()).toHaveLength(0);

    // End editing (pointer down outside the note) and paste on the board.
    fireEvent.pointerDown(document.body);
    await act(async () => {
      window.dispatchEvent(makePaste([png]));
    });
    await waitFor(() => expect(images()).toHaveLength(1));
    // 100×50 centred in the 1024×768 view at camera (0,0,1): (512, 384).
    const id = images()[0].id;
    expect(imgField(id, 'x')).toBe(512 - 50);
    expect(imgField(id, 'y')).toBe(384 - 25);
  });

  it('TC-19: while reconnecting, a drop shows the offline toast and adds nothing', async () => {
    await mount('reconnecting');
    const files = [file('a.png', 'image/png')];
    await drop(files, 10, 10);
    expect(screen.getByText(REJECTION_MESSAGES.offline)).toBeTruthy();
    expect(images()).toHaveLength(0);
    expect(h.uploadImage).not.toHaveBeenCalled();
    // The picker is gated the same way.
    fireEvent.click(screen.getByRole('button', { name: 'Image (I)' }));
    expect(screen.getAllByText(REJECTION_MESSAGES.offline).length).toBeGreaterThanOrEqual(1);
    expect(h.uploadImage).not.toHaveBeenCalled();
  });

  it('TC-29: a file that fails to decode is refused with the type toast; no placeholder', async () => {
    await mount();
    bitmap.reject.add('corrupt.png');
    const files = [file('corrupt.png', 'image/png'), file('good.png', 'image/png')];
    bitmap.dims.set('good.png', [60, 30]);
    await drop(files, 20, 20);
    expect(screen.getByText(REJECTION_MESSAGES.type)).toBeTruthy();
    // Only the decodable file becomes a placeholder; the corrupt one never uploads.
    await waitFor(() => expect(images()).toHaveLength(1));
    expect(h.uploadImage).toHaveBeenCalledTimes(1);
    expect(h.uploadImage.mock.calls[0][1].name).toBe('good.png');
  });

  it('drop of a mixed batch: supported files added, toasts for the refusals', async () => {
    await mount();
    bitmap.dims.set('ok.webp', [32, 32]);
    const files = [
      file('doc.pdf', 'application/pdf'), // renamed/unsupported type
      file('ok.webp', 'image/webp'),
    ];
    await drop(files, 30, 30);
    expect(screen.getByText(REJECTION_MESSAGES.type)).toBeTruthy();
    await waitFor(() => expect(images()).toHaveLength(1));
    expect(h.uploadImage).toHaveBeenCalledTimes(1);
  });
});
