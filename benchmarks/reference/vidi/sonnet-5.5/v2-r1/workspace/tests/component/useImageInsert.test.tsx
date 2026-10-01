import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initDoc, snapshot } from '../../src/shared/board-model';
import type { ImageSnap } from '../../src/shared/objects/image';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { useImageInsert } from '../../src/client/images/useImageInsert';
import type { ConnectionState } from '../../src/client/sync/connectBoard';
import type { UploadResult } from '../../src/client/images/uploadImage';

type Deferred = { resolve(r: UploadResult): void; progress(f: number): void; file: File };
const uploads: Deferred[] = [];

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn((_board: string, file: File, onProgress: (f: number) => void) => {
    let resolve!: (r: UploadResult) => void;
    const promise = new Promise<UploadResult>((r) => (resolve = r));
    uploads.push({ resolve, progress: onProgress, file });
    return { promise, abort: () => undefined };
  }),
}));

const png = (name: string) => new File(['x'], name, { type: 'image/png' });
const images = (doc: Y.Doc) => snapshot(doc).filter((o) => o.type === 'image') as ImageSnap[];

function setup(connection: ConnectionState = 'connected') {
  const doc = new Y.Doc();
  initDoc(doc);
  const hook = renderHook(
    (props: { connection: ConnectionState }) =>
      useImageInsert({
        doc,
        boardId: 'b'.repeat(22),
        camera: { x: 0, y: 0, zoom: 1 },
        connection: props.connection,
        identityId: 'me',
        viewCentre: () => ({ x: 500, y: 300 }),
      }),
    { initialProps: { connection } },
  );
  return { doc, hook };
}

const dropEvent = (files: File[], x: number, y: number) =>
  ({
    dataTransfer: { types: ['Files'], files, dropEffect: 'none' },
    clientX: x,
    clientY: y,
    currentTarget: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    preventDefault: vi.fn(),
  }) as never;

function paste(target: Element, files: File[]) {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { files } });
  act(() => {
    target.dispatchEvent(e);
  });
  return e;
}

beforeEach(() => {
  uploads.length = 0;
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (file: File) => {
      if (file.name.startsWith('corrupt')) throw new Error('decode');
      return { width: 100, height: 60, close() {} };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useImageInsert', () => {
  it('TC-17: dropping three files makes a row of placeholders from the drop point, with progress, then ready', async () => {
    const { doc, hook } = setup();
    act(() => hook.result.current.onDrop(dropEvent([png('a.png'), png('b.png'), png('c.png')], 200, 100)));
    await waitFor(() => expect(images(doc)).toHaveLength(3));
    const sorted = [...images(doc)].sort((p, q) => p.x - q.x);
    expect(sorted.map((i) => i.x)).toEqual([200, 324, 448]);
    expect(sorted.every((i) => i.y === 100 && i.width === 100 && i.height === 60 && i.status === 'uploading')).toBe(true);
    expect(sorted.every((i) => i.uploaderId === 'me')).toBe(true);

    act(() => uploads[0].progress(0.4));
    const first = images(doc).find((i) => i.id === [...hook.result.current.progress.keys()][0])!;
    expect(hook.result.current.progress.get(first.id)).toBe(0.4);

    await act(async () => uploads[0].resolve({ kind: 'ok', assetKey: 'k/1' }));
    expect(images(doc).filter((i) => i.status === 'ready')).toHaveLength(1);
    expect(hook.result.current.progress.has(first.id)).toBe(false);
  });

  it('TC-18: pasting while editing text adds nothing; pasting on the board centres the image', async () => {
    const { doc, hook } = setup();
    const area = document.createElement('textarea');
    document.body.appendChild(area);
    area.focus();
    const typed = paste(area, [png('p.png')]);
    expect(typed.defaultPrevented).toBe(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(images(doc)).toHaveLength(0);
    area.remove();

    const board = document.createElement('div');
    document.body.appendChild(board);
    const e = paste(board, [png('p.png')]);
    expect(e.defaultPrevented).toBe(true);
    await waitFor(() => expect(images(doc)).toHaveLength(1));
    const [img] = images(doc);
    expect(img.x + img.width! / 2).toBe(500);
    expect(img.y + img.height! / 2).toBe(300);
    board.remove();
    hook.unmount();
  });

  it('TC-19: offline drops show the offline toast and create nothing', async () => {
    const { doc, hook } = setup('reconnecting');
    act(() => hook.result.current.onDrop(dropEvent([png('a.png')], 10, 10)));
    await waitFor(() => expect(hook.result.current.toast).toBe(REJECTION_MESSAGES.offline));
    expect(images(doc)).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });

  it('TC-29: a file that cannot be decoded gets the type toast and no placeholder', async () => {
    const { doc, hook } = setup();
    act(() => hook.result.current.onDrop(dropEvent([png('corrupt.png'), png('ok.png')], 0, 0)));
    await waitFor(() => expect(images(doc)).toHaveLength(1));
    expect(hook.result.current.toast).toBe(REJECTION_MESSAGES.type);
    expect(uploads).toHaveLength(1);
  });

  it('shows the drop highlight only for file drags', () => {
    const { hook } = setup();
    act(() => hook.result.current.onDragEnter({ dataTransfer: { types: ['text/plain'] } } as never));
    expect(hook.result.current.dragActive).toBe(false);
    act(() => hook.result.current.onDragEnter({ dataTransfer: { types: ['Files'] } } as never));
    expect(hook.result.current.dragActive).toBe(true);
    act(() => hook.result.current.onDragLeave({ dataTransfer: { types: ['Files'] } } as never));
    expect(hook.result.current.dragActive).toBe(false);
  });

  it('a failed upload can be retried while the file is in memory', async () => {
    const { doc, hook } = setup();
    act(() => hook.result.current.onDrop(dropEvent([png('a.png')], 0, 0)));
    await waitFor(() => expect(images(doc)).toHaveLength(1));
    await act(async () => uploads[0].resolve({ kind: 'failed', status: 500 }));
    const id = images(doc)[0].id;
    expect(images(doc)[0].status).toBe('failed');
    expect(hook.result.current.canRetry(id)).toBe(true);
    act(() => {
      expect(hook.result.current.retry(id)).toBe(true);
    });
    expect(images(doc)[0].status).toBe('uploading');
    expect(uploads).toHaveLength(2);
  });
});
