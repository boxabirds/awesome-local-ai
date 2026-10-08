// Component tests (story 12, image.insert — TC-17, TC-18, TC-19, TC-29):
// the useImageInsert hook in jsdom with a mocked uploadImage. Drop, paste
// and rejection flows create (or refuse) image objects exactly as the
// contract requires.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, objectsSnapshot } from '../../src/shared/board-model';
import {
  useImageInsert,
  type UseImageInsert,
} from '../../src/client/images/useImageInsert';
import {
  uploadImage,
  type UploadResult,
} from '../../src/client/images/uploadImage';
import { ImageObject } from '../../src/client/objects/ImageObject';
import { type ImageSnap, placementSize } from '../../src/shared/objects/image';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import type { Camera } from '../../src/client/canvas/camera';
import { fileFromBytes, pngBytes, pdfBytes } from '../fixtures/images';

vi.mock('../../src/client/images/uploadImage', () => ({
  uploadImage: vi.fn(),
}));

const mockUpload = vi.mocked(uploadImage);

/** The board id used by every test in this file. */
const BOARD_ID = 'b'.repeat(22);
const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

interface PendingUpload {
  onProgress(fraction: number): void;
  resolve(result: UploadResult): void;
}

/** Queue one mocked upload that the test controls. */
function queuePending(): PendingUpload {
  let resolveFn: (r: UploadResult) => void = () => undefined;
  const promise = new Promise<UploadResult>((resolve) => {
    resolveFn = resolve;
  });
  let progressFn: (f: number) => void = () => undefined;
  mockUpload.mockImplementationOnce((_boardId, _file, onProgress) => {
    progressFn = onProgress;
    return { promise, abort: vi.fn() };
  });
  return {
    onProgress: (f: number) => progressFn(f),
    resolve: (r: UploadResult) => resolveFn(r),
  };
}

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function renderInsert(
  over: Partial<{ connection: 'connected' | 'reconnecting'; identityId: string }> = {},
) {
  const doc = makeDoc();
  const hook = renderHook(() =>
    useImageInsert({
      doc,
      boardId: BOARD_ID,
      camera: CAMERA,
      connection: over.connection ?? 'connected',
      identityId: over.identityId ?? 'me',
    }),
  ).result;
  return { doc, hook: hook as { current: UseImageInsert } };
}

/** Flush microtasks (the async decode + insert path) inside act. */
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function dropEvent(files: File[], clientX: number, clientY: number): DragEvent {
  const ev = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent & {
    clientX: number;
    clientY: number;
  };
  Object.defineProperty(ev, 'dataTransfer', {
    value: { files, types: ['Files'], dropEffect: '' },
  });
  Object.defineProperty(ev, 'clientX', { value: clientX });
  Object.defineProperty(ev, 'clientY', { value: clientY });
  return ev;
}

function pasteEvent(files: File[]): ClipboardEvent {
  const ev = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
  Object.defineProperty(ev, 'clipboardData', { value: { files } });
  return ev;
}

const imageObjects = (doc: Y.Doc) =>
  objectsSnapshot(doc).filter((o) => o.type === 'image') as ImageSnap[];

describe('useImageInsert (story 12)', () => {
  beforeEach(() => {
    mockUpload.mockReset();
  });

  it('TC-17: a drop of 3 files creates 3 placeholders in a row at the drop point, shows progress, then ready', async () => {
    const { doc, hook } = renderInsert();
    const f1 = fileFromBytes('a.png', pngBytes(400, 300), 'image/png');
    const f2 = fileFromBytes('b.png', pngBytes(200, 100), 'image/png');
    const f3 = fileFromBytes('c.png', pngBytes(100, 400), 'image/png');
    const p1 = queuePending();
    const p2 = queuePending();
    const p3 = queuePending();

    await act(async () => {
      hook.current.onDrop(dropEvent([f1, f2, f3], 100, 50));
      await flush();
    });

    const snaps = imageObjects(doc);
    expect(snaps).toHaveLength(3);
    for (const s of snaps) {
      expect(s.status).toBe('uploading');
      expect(s.uploaderId).toBe('me');
      expect(s.assetKey).toBeNull();
    }
    // Row layout: top-left anchored at the drop point, 24-unit gaps.
    const [s1, s2, s3] = snaps as [ImageSnap, ImageSnap, ImageSnap];
    expect([s1.x, s1.y]).toEqual([100, 50]);
    const gap = 24;
    expect(s2.x).toBeCloseTo(s1.x + s1.width! + gap);
    expect(s3.x).toBeCloseTo(s2.x + s2.width! + gap);
    expect(s2.y).toBe(s1.y);
    expect(s3.y).toBe(s1.y);
    // Sizes: placementSize of the natural dimensions (never upscaled).
    const expected1 = placementSize(400, 300);
    expect(s1.width).toBe(expected1.width);
    expect(s1.height).toBe(expected1.height);
    expect(s2.width).toBe(200);
    expect(s2.height).toBe(100);
    expect(s3.width).toBe(100);
    expect(s3.height).toBe(400);

    // Progress updates flow into the hook state.
    await act(async () => {
      p1.onProgress(0.25);
      p2.onProgress(0.5);
      await flush();
    });
    expect(hook.current.progress.get(s1.id)).toBeCloseTo(0.25);
    expect(hook.current.progress.get(s2.id)).toBeCloseTo(0.5);

    // The uploader's ImageObject shows the percentage.
    render(
      <ImageObject
        image={s1}
        isUploader
        progress={hook.current.progress.get(s1.id)}
        canRetry
        now={Date.now()}
        onRetry={() => undefined}
        onRemove={() => undefined}
      />,
    );
    expect(screen.getByTestId('image-percent')).toHaveTextContent('25%');

    // Uploads complete: ready with asset keys, progress cleared.
    await act(async () => {
      p1.resolve({ kind: 'ok', assetKey: `${BOARD_ID}/a1` });
      p2.resolve({ kind: 'ok', assetKey: `${BOARD_ID}/a2` });
      p3.resolve({ kind: 'ok', assetKey: `${BOARD_ID}/a3` });
      await flush();
    });
    const final = imageObjects(doc);
    for (const s of final) {
      expect(s.status).toBe('ready');
      expect(s.assetKey).toMatch(new RegExp(`^${BOARD_ID}/`));
    }
    expect(hook.current.progress.size).toBe(0);
  });

  it('TC-18: paste adds nothing while a text editor has focus, and adds centred when the board has focus', async () => {
    const { doc, hook } = renderInsert();
    const file = fileFromBytes('clip.png', pngBytes(400, 300), 'image/png');
    const p1 = queuePending();

    // While a textarea has focus the window paste belongs to the editor.
    const { unmount } = render(<textarea data-testid="editor" />);
    screen.getByTestId('editor').focus();
    await act(async () => {
      window.dispatchEvent(pasteEvent([file]));
      await flush();
    });
    expect(imageObjects(doc)).toHaveLength(0);
    expect(mockUpload).not.toHaveBeenCalled();
    unmount();

    // Board focus (no editable target): the image is added centred in the
    // visible area. jsdom's viewport is 1024x768, so the centre is
    // (512, 384) at this camera.
    document.body.focus();
    await act(async () => {
      window.dispatchEvent(pasteEvent([file]));
      await flush();
    });
    const snaps = imageObjects(doc);
    expect(snaps).toHaveLength(1);
    const s = snaps[0]!;
    expect(s.width).toBe(400);
    expect(s.height).toBe(300);
    expect(s.x).toBeCloseTo(512 - 200);
    expect(s.y).toBeCloseTo(384 - 150);
    await act(async () => {
      p1.resolve({ kind: 'ok', assetKey: `${BOARD_ID}/a1` });
      await flush();
    });
  });

  it('TC-19: while reconnecting, a drop shows the offline toast, adds nothing and does not upload', async () => {
    const { doc, hook } = renderInsert({ connection: 'reconnecting' });
    const file = fileFromBytes('a.png', pngBytes(100, 100), 'image/png');

    await act(async () => {
      hook.current.onDrop(dropEvent([file], 10, 10));
      await flush();
    });

    expect(hook.current.toasts).toContain(REJECTION_MESSAGES.offline);
    expect(imageObjects(doc)).toHaveLength(0);
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it('TC-29: a disguised PDF (image/png mime) fails to decode: type message, the rest of the batch still added', async () => {
    const { doc, hook } = renderInsert();
    const good = fileFromBytes('good.png', pngBytes(120, 80), 'image/png');
    const disguised = fileFromBytes('notpng.png', pdfBytes(), 'image/png');
    const p1 = queuePending();

    await act(async () => {
      hook.current.onDrop(dropEvent([good, disguised], 0, 0));
      await flush();
    });

    // Only the decodable file becomes an object.
    const snaps = imageObjects(doc);
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.naturalWidth).toBe(120);
    expect(snaps[0]!.naturalHeight).toBe(80);
    // The decode failure is reported with the type message.
    expect(hook.current.toasts).toContain(REJECTION_MESSAGES.type);
    expect(mockUpload).toHaveBeenCalledTimes(1);
    await act(async () => {
      p1.resolve({ kind: 'ok', assetKey: `${BOARD_ID}/a1` });
      await flush();
    });
  });
});
