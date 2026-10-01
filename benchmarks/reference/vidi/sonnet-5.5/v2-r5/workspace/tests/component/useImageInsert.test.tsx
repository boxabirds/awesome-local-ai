import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import type { UploadResult } from '../../src/client/images/uploadImage';
import { newDoc } from './helpers';

const mocks = vi.hoisted(() => ({
  uploads: [] as Array<{ file: File; onProgress(f: number): void; resolve(r: UploadResult): void }>,
}));

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: (_board: string, file: File, onProgress: (f: number) => void) => {
    let resolve!: (r: UploadResult) => void;
    const promise = new Promise<UploadResult>((r) => { resolve = r; });
    mocks.uploads.push({ file, onProgress, resolve });
    return { promise, abort: () => {} };
  },
}));

import { useImageInsert } from '../../src/client/images/useImageInsert';
import { createUndo } from '../../src/client/board/undo';
import { snapshotObjects, createSticky } from '../../src/shared/board-model';
import type { ImageSnap } from '../../src/shared/objects/image';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import { Toast } from '../../src/client/ui/Toast';

const camera = { x: 0, y: 0, zoom: 1 };
let doc: Y.Doc;
let api: ReturnType<typeof useImageInsert>;
const images = () => snapshotObjects(doc).filter((o): o is ImageSnap => o.type === 'image');

function Harness({ connection = 'connected' }: { connection?: ConnectionState }) {
  api = useImageInsert({
    doc, boardId: 'b'.repeat(22), camera, connection, identityId: 'g_me', viewSize: () => ({ width: 1000, height: 600 }),
  });
  return (
    <div>
      <Toast />
      <textarea aria-label="note text" />
      <output data-testid="progress">{[...api.progress.values()].map((p) => Math.round(p * 100)).join(',')}</output>
    </div>
  );
}

const png = (name: string, type = 'image/png') => new File(['x'], name, { type });
const dropEvent = (files: File[], x: number, y: number) => ({
  dataTransfer: { files, types: ['Files'], dropEffect: 'none' } as unknown as DataTransfer,
  clientX: x, clientY: y, preventDefault: vi.fn(),
});

beforeEach(() => {
  doc = newDoc();
  mocks.uploads.length = 0;
  vi.stubGlobal('createImageBitmap', vi.fn(async (f: File) => {
    if (f.name.startsWith('corrupt')) throw new Error('decode');
    return { width: f.name.startsWith('big') ? 1600 : 400, height: f.name.startsWith('big') ? 1200 : 300, close() {} };
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('useImageInsert', () => {
  it('TC-17 drop of 3 files makes 3 placeholders in a row from the drop point, with live progress, then ready', async () => {
    render(<Harness />);
    await act(async () => { api.onDrop(dropEvent([png('a.png'), png('big.png'), png('c.png')], 100, 50)); });
    await waitFor(() => expect(images()).toHaveLength(3));
    const [a, b, c] = images();
    expect([a.x, a.y, a.width, a.height]).toEqual([100, 50, 400, 300]);
    expect([b.x, b.width, b.height]).toEqual([100 + 400 + 24, 800, 600]);
    expect(c.x).toBe(100 + 400 + 24 + 800 + 24);
    expect(images().every((i) => i.status === 'uploading' && i.uploaderId === 'g_me')).toBe(true);
    expect(mocks.uploads).toHaveLength(3);
    act(() => mocks.uploads[0].onProgress(0.42));
    expect(screen.getByTestId('progress').textContent).toContain('42');
    await act(async () => { mocks.uploads[0].resolve({ kind: 'ok', assetKey: 'k/a' }); });
    expect(images()[0]).toMatchObject({ status: 'ready', assetKey: 'k/a' });
    await act(async () => { mocks.uploads[1].resolve({ kind: 'failed', status: 500 }); });
    expect(images()[1].status).toBe('failed');
    expect(api.canRetry(images()[1].id)).toBe(true);
  });

  it('the whole add is one undo step', async () => {
    const undo = createUndo(doc);
    createSticky(doc, { x: 0, y: 0 });
    undo.boundary();
    render(<Harness />);
    await act(async () => { api.onDrop(dropEvent([png('a.png'), png('b.png')], 0, 0)); });
    await waitFor(() => expect(images()).toHaveLength(2));
    undo.boundary();
    undo.undo();
    expect(images()).toHaveLength(0);
  });

  it('TC-18 paste while editing text adds nothing; paste on the board centres the image in view', async () => {
    render(<Harness />);
    const file = png('shot.png');
    const clip = { files: [file], types: ['Files'] };
    const area = screen.getByLabelText('note text');
    area.focus();
    const editing = new Event('paste', { bubbles: true, cancelable: true }) as unknown as ClipboardEvent;
    Object.defineProperty(editing, 'clipboardData', { value: clip });
    await act(async () => { area.dispatchEvent(editing); });
    expect(editing.defaultPrevented).toBe(false);
    expect(images()).toHaveLength(0);

    area.blur();
    const onBoard = new Event('paste', { bubbles: true, cancelable: true }) as unknown as ClipboardEvent;
    Object.defineProperty(onBoard, 'clipboardData', { value: clip });
    await act(async () => { document.body.dispatchEvent(onBoard); });
    await waitFor(() => expect(images()).toHaveLength(1));
    const [img] = images();
    expect(img.x + img.width! / 2).toBeCloseTo(500); // view is 1000 x 600 at camera origin
    expect(img.y + img.height! / 2).toBeCloseTo(300);
  });

  it('TC-19 dropping while reconnecting shows the offline toast and creates nothing', async () => {
    render(<Harness connection="reconnecting" />);
    await act(async () => { api.onDrop(dropEvent([png('a.png')], 0, 0)); });
    expect(screen.getByText("You're offline — images can be added when you reconnect.")).toBeTruthy();
    expect(images()).toHaveLength(0);
    expect(mocks.uploads).toHaveLength(0);
  });

  it('TC-29 an undecodable file gets the type toast and no placeholder; the others are still added', async () => {
    render(<Harness />);
    await act(async () => { api.onDrop(dropEvent([png('corrupt.png'), png('ok.png')], 0, 0)); });
    await waitFor(() => expect(images()).toHaveLength(1));
    expect(screen.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeTruthy();
    expect(mocks.uploads).toHaveLength(1);
  });

  it('refused types, sizes and counts are explained and supported files are still added', async () => {
    render(<Harness />);
    const huge = png('huge.png');
    Object.defineProperty(huge, 'size', { value: 11 * 1024 * 1024 });
    await act(async () => { api.onDrop(dropEvent([png('doc.pdf', 'application/pdf'), huge, png('ok.png')], 0, 0)); });
    await waitFor(() => expect(images()).toHaveLength(1));
    expect(screen.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeTruthy();
    expect(screen.getByText('Images must be 10 MB or smaller.')).toBeTruthy();
  });

  it('shows the drop highlight state only for file drags', () => {
    render(<Harness />);
    act(() => api.onDragEnter({ ...dropEvent([], 0, 0), dataTransfer: { types: ['text/plain'] } as unknown as DataTransfer }));
    expect(api.dragActive).toBe(false);
    act(() => api.onDragEnter(dropEvent([], 0, 0)));
    expect(api.dragActive).toBe(true);
    act(() => api.onDragLeave(dropEvent([], 0, 0)));
    expect(api.dragActive).toBe(false);
  });

  it('the picker is not opened while offline', () => {
    render(<Harness connection="reconnecting" />);
    const click = vi.fn();
    (api.inputRef as { current: unknown }).current = { click };
    act(() => api.openPicker());
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByText(/You're offline/)).toBeTruthy();
  });
});
