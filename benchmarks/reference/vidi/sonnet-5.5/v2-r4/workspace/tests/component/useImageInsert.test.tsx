import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshot } from '../../src/shared/board-model';
import { createSticky } from '../../src/shared/board-model';
import { IMAGE_LAYOUT_GAP_WORLD } from '../../src/shared/config';
import type { ImageSnap } from '../../src/shared/objects/image';
import type { UploadResult } from '../../src/client/images/uploadImage';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { clearToasts, ToastHost } from '../../src/client/ui/Toast';

type Pending = { resolve(r: UploadResult): void; progress(f: number): void; file: File };
const pending: Pending[] = [];
const uploadMock = vi.fn((_board: string, file: File, onProgress: (f: number) => void) => {
  let resolve!: (r: UploadResult) => void;
  const promise = new Promise<UploadResult>((r) => (resolve = r));
  pending.push({ resolve, progress: onProgress, file });
  return { promise, abort() {} };
});
vi.mock('../../src/client/images/uploadImage', () => ({ uploadImage: (...a: Parameters<typeof uploadMock>) => uploadMock(...a) }));

const { useImageInsert } = await import('../../src/client/images/useImageInsert');

const CAMERA = { x: 0, y: 0, zoom: 1 };
const png = (name = 'a.png') => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
const dims = new Map<File, { w: number; h: number }>();
const images = (doc: Y.Doc) => snapshot(doc).filter((o): o is ImageSnap => o.type === 'image');

function setup(connection: ConnectionState = 'connected') {
  const doc = new Y.Doc();
  const hook = renderHook(() => useImageInsert({ doc, boardId: 'B'.repeat(22), camera: CAMERA, connection, identityId: 'g_me' }));
  return { doc, hook };
}

const dropEvent = (files: File[], x: number, y: number) => ({
  clientX: x,
  clientY: y,
  preventDefault: vi.fn(),
  dataTransfer: { types: ['Files'], files, dropEffect: 'none' } as unknown as DataTransfer,
});

beforeEach(() => {
  pending.length = 0;
  uploadMock.mockClear();
  clearToasts();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (f: File) => {
      const d = dims.get(f);
      if (!d) throw new Error('corrupt');
      return { width: d.w, height: d.h, close() {} };
    }),
  );
  vi.stubGlobal('innerWidth', 1000);
  vi.stubGlobal('innerHeight', 600);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const sized = (name: string, w: number, h: number) => {
  const f = png(name);
  dims.set(f, { w, h });
  return f;
};

describe('useImageInsert', () => {
  it('TC-17: dropping 3 files places a row from the drop point, shows progress, then ready', async () => {
    const { doc, hook } = setup();
    const files = [sized('a.png', 400, 300), sized('b.png', 1600, 1200), sized('c.png', 100, 100)];
    await act(async () => hook.result.current.onDrop(dropEvent(files, 200, 100)));
    const imgs = images(doc);
    expect(imgs).toHaveLength(3);
    const byX = [...imgs].sort((p, q) => p.x - q.x);
    expect(byX[0]).toMatchObject({ x: 200, y: 100, width: 400, height: 300, status: 'uploading' });
    expect(byX[1]).toMatchObject({ x: 200 + 400 + IMAGE_LAYOUT_GAP_WORLD, y: 100, width: 800, height: 600 });
    expect(byX[2].x).toBe(byX[1].x + 800 + IMAGE_LAYOUT_GAP_WORLD);
    expect(uploadMock).toHaveBeenCalledTimes(3);
    act(() => pending[0].progress(0.5));
    const id0 = images(doc).find((i) => i.naturalWidth === 400)!.id;
    expect(hook.result.current.progress.get(id0)).toBe(0.5);
    await act(async () => pending[0].resolve({ kind: 'ok', assetKey: 'k/1' }));
    const done = images(doc).find((i) => i.id === id0)!;
    expect(done).toMatchObject({ status: 'ready', assetKey: 'k/1' });
    expect(hook.result.current.progress.has(id0)).toBe(false);
  });

  it('TC-17: the drop is one undo step worth of placeholders and highlights only file drags', async () => {
    const { hook } = setup();
    const e = { clientX: 0, clientY: 0, preventDefault: vi.fn(), dataTransfer: { types: ['text/plain'] } as unknown as DataTransfer };
    act(() => hook.result.current.onDragEnter(e));
    expect(hook.result.current.dragActive).toBe(false);
    const fileDrag = { dataTransfer: { types: ['Files'] } as unknown as DataTransfer };
    act(() => hook.result.current.onDragEnter(fileDrag));
    expect(hook.result.current.dragActive).toBe(true);
    act(() => hook.result.current.onDragLeave(fileDrag));
    expect(hook.result.current.dragActive).toBe(false);
  });

  it('TC-18: paste is centred in view when the board has focus', async () => {
    const { doc, hook } = setup();
    const f = sized('p.png', 200, 100);
    const preventDefault = vi.fn();
    await act(async () => hook.result.current.onPaste({ clipboardData: { files: [f], items: [] } as unknown as DataTransfer, target: document.body, preventDefault }));
    const [img] = images(doc);
    expect(img.x + img.width / 2).toBeCloseTo(500);
    expect(img.y + img.height / 2).toBeCloseTo(300);
    expect(preventDefault).toHaveBeenCalled();
  });

  it('TC-18: paste while editing text adds nothing', async () => {
    const { doc, hook } = setup();
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    ta.focus();
    const f = sized('p.png', 200, 100);
    const preventDefault = vi.fn();
    await act(async () => hook.result.current.onPaste({ clipboardData: { files: [f], items: [] } as unknown as DataTransfer, target: ta, preventDefault }));
    expect(images(doc)).toHaveLength(0);
    expect(preventDefault).not.toHaveBeenCalled();
    ta.remove();
  });

  it('paste without image files is ignored', async () => {
    const { doc, hook } = setup();
    const preventDefault = vi.fn();
    await act(async () => hook.result.current.onPaste({ clipboardData: { files: [], items: [] } as unknown as DataTransfer, target: document.body, preventDefault }));
    expect(images(doc)).toHaveLength(0);
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('TC-19: offline drop shows the offline toast, creates nothing and never uploads', async () => {
    render(<ToastHost />);
    const { doc, hook } = setup('reconnecting');
    await act(async () => hook.result.current.onDrop(dropEvent([sized('a.png', 10, 10)], 0, 0)));
    expect(screen.getByText("You're offline — images can be added when you reconnect.")).toBeTruthy();
    expect(images(doc)).toHaveLength(0);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('TC-19: the picker does not open while offline', () => {
    render(<ToastHost />);
    const { hook } = setup('reconnecting');
    const spy = vi.spyOn(HTMLInputElement.prototype, 'click');
    act(() => hook.result.current.openPicker());
    expect(spy).not.toHaveBeenCalled();
    expect(screen.getByText(/You're offline/)).toBeTruthy();
    spy.mockRestore();
  });

  it('opens a multiple image-only picker when online and adds the chosen files centred', async () => {
    const { doc, hook } = setup();
    const spy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    act(() => hook.result.current.openPicker());
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe('image/png,image/jpeg,image/gif,image/webp');
    Object.defineProperty(input, 'files', { value: [sized('x.png', 50, 50)] });
    await act(async () => input.onchange?.(new Event('change')));
    expect(images(doc)).toHaveLength(1);
    spy.mockRestore();
  });

  it('TC-29: an undecodable file gives the type toast and no placeholder', async () => {
    render(<ToastHost />);
    const { doc, hook } = setup();
    await act(async () => hook.result.current.onDrop(dropEvent([png('corrupt.png')], 0, 0)));
    expect(screen.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeTruthy();
    expect(images(doc)).toHaveLength(0);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('refused files are explained while supported ones from the same drop are added', async () => {
    render(<ToastHost />);
    const { doc, hook } = setup();
    const pdf = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    await act(async () => hook.result.current.onDrop(dropEvent([pdf, sized('ok.png', 20, 20)], 5, 5)));
    expect(images(doc)).toHaveLength(1);
    expect(screen.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeTruthy();
  });

  it('a failed upload marks the image failed and keeps the file for Retry', async () => {
    const { doc, hook } = setup();
    await act(async () => hook.result.current.onDrop(dropEvent([sized('a.png', 20, 20)], 0, 0)));
    const id = images(doc)[0].id;
    await act(async () => pending[0].resolve({ kind: 'failed', status: 500 }));
    expect(images(doc)[0].status).toBe('failed');
    expect(hook.result.current.canRetry(id)).toBe(true);
    act(() => {
      hook.result.current.retry(id);
    });
    expect(images(doc)[0].status).toBe('uploading');
    expect(uploadMock).toHaveBeenCalledTimes(2);
    await act(async () => pending[1].resolve({ kind: 'ok', assetKey: 'k/2' }));
    await waitFor(() => expect(images(doc)[0].status).toBe('ready'));
    expect(hook.result.current.canRetry(id)).toBe(false);
  });

  it('does not touch other objects', async () => {
    const { doc, hook } = setup();
    createSticky(doc, { x: 0, y: 0 });
    await act(async () => hook.result.current.onDrop(dropEvent([sized('a.png', 20, 20)], 0, 0)));
    expect(snapshot(doc)).toHaveLength(2);
  });
});
