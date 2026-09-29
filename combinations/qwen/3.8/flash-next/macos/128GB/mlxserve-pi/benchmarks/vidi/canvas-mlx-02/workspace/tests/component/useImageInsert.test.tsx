// The insert flow, end to end but without a network: the hook is rendered with
// `uploadImage` mocked and the browser's image decoder stubbed, so what is under test
// is the ORCHESTRATION - the offline gate, validation, decoding to a size, the
// one-undo-step placement, the parallel uploads and the statuses they write back, and
// the toasts each refusal shows (TC-17 to TC-20, TC-29 at the flow level).
//
// The mock upload is a switch a test flips: `ok`, `rate_limited` or `failed`. That is
// the whole contract between the flow and the wire; everything the flow does around it
// is real.
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import type React from 'react';
import { objectsSnapshot } from '../../src/shared/board-model.ts';
import { isImageSnapshot } from '../../src/shared/objects/image.ts';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles.ts';
import { useImageInsert, type ImageInsertArgs } from '../../src/client/images/useImageInsert.ts';
import type { UploadResult } from '../../src/client/images/uploadImage.ts';

// The upload is the only thing in this flow that touches a wire; every test sets
// `uploadImpl` to the outcome it wants the server to report.
const upload = vi.hoisted(() => ({
  impl: (_boardId: string, _file: File, _onProgress: (f: number) => void): UploadResult | Promise<UploadResult> => ({
    kind: 'ok',
    assetKey: 'abcdefghij0123456789AB/ABCDEFGHIJ0123456789AB',
  }),
  calls: 0,
}));

vi.mock('../../src/client/images/uploadImage.ts', () => ({
  uploadImage: vi.fn((boardId: string, file: File, onProgress: (f: number) => void) => {
    upload.calls += 1;
    // Progress reports then the answer, exactly like the real XHR handle. The impl
    // may return a promise, so a test can hold an upload open and watch the
    // placeholder sit in `uploading` before it flips.
    return { promise: Promise.resolve(upload.impl(boardId, file, onProgress)), abort: () => {} };
  }),
}));

/** An upload a test can settle by hand, to observe the uploading state first. */
function deferredUpload(): { impl(): Promise<UploadResult>; settle(r: UploadResult): void } {
  let resolve!: (r: UploadResult) => void;
  const promise = new Promise<UploadResult>((res) => (resolve = res));
  return { impl: () => promise, settle: (r) => resolve(r) };
}

/** A file the decoder is told to read as `w`x`h`. */
function imageFile(name: string, type = 'image/png', w = 200, h = 100): File {
  const f = new File([new Uint8Array(16)], name, { type });
  DECODE_SIZES.set(f, { width: w, height: h });
  return f;
}
const DECODE_SIZES = new WeakMap<File, { width: number; height: number }>();

function makeArgs(over: Partial<ImageInsertArgs> = {}): ImageInsertArgs {
  return {
    doc: new Y.Doc(),
    boardId: 'abcdefghij0123456789AB',
    camera: { x: 0, y: 0, zoom: 1 },
    connection: 'connected',
    identityId: 'tab-1',
    viewport: { width: 1000, height: 800 },
    ...over,
  };
}

/** A file-drop event the hook can read (only the fields it uses are filled in). */
function dropEvent(files: File[], clientX = 100, clientY = 100): React.DragEvent {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 } as DOMRect);
  return {
    preventDefault: () => {},
    dataTransfer: { files, types: ['Files'] },
    currentTarget: el,
    clientX,
    clientY,
  } as unknown as React.DragEvent;
}

/** A clipboard paste carrying image files. */
function pasteEvent(files: File[]): { clipboardData: { files: File[] }; preventDefault(): void } {
  return { clipboardData: { files }, preventDefault: () => {} };
}

beforeEach(() => {
  upload.calls = 0;
  upload.impl = () => ({ kind: 'ok', assetKey: 'abcdefghij0123456789AB/ABCDEFGHIJ0123456789AB' });
  vi.stubGlobal(
    'createImageBitmap',
    (file: File) =>
      Promise.resolve({
        width: DECODE_SIZES.get(file)?.width ?? 200,
        height: DECODE_SIZES.get(file)?.height ?? 100,
        close: () => {},
      }),
  );
});

describe('useImageInsert drop (TC-17)', () => {
  it('drops a valid image: placeholder appears then becomes ready with its key', async () => {
    // Hold the upload open so the uploading placeholder is really observable before
    // the answer arrives, then release it and watch the flip to ready.
    const held = deferredUpload();
    upload.impl = held.impl;
    const args = makeArgs();
    const { result } = renderHook(() => useImageInsert(args));

    act(() => result.current.onDrop(dropEvent([imageFile('photo.png')], 100, 100)));

    // a placeholder exists immediately, and it is an uploading image
    await waitFor(() => expect(objectsSnapshot(args.doc).length).toBe(1));
    const obj = objectsSnapshot(args.doc)[0];
    expect(isImageSnapshot(obj) && obj.status).toBe('uploading');
    // the drop point is its top-left corner (camera is the identity here)
    expect(obj!.x).toBe(100);
    expect(obj!.y).toBe(100);

    // the upload finishes: ready, with the assetKey the mock returned
    act(() => held.settle({ kind: 'ok', assetKey: 'abcdefghij0123456789AB/ABCDEFGHIJ0123456789AB' }));
    await waitFor(() => {
      const after = objectsSnapshot(args.doc)[0];
      expect(isImageSnapshot(after) && after.status).toBe('ready');
    });
    const ready = objectsSnapshot(args.doc)[0];
    expect(isImageSnapshot(ready) && ready.assetKey).toBe('abcdefghij0123456789AB/ABCDEFGHIJ0123456789AB');
    // progress is cleared once it is done
    expect(result.current.progress.size).toBe(0);
  });

  it('drops several at once in a single undo step, left to right', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useImageInsert(args));
    act(() =>
      result.current.onDrop(
        dropEvent([imageFile('a.png'), imageFile('b.png'), imageFile('c.png')], 0, 0),
      ),
    );
    await waitFor(() => expect(objectsSnapshot(args.doc).length).toBe(3));
    const xs = objectsSnapshot(args.doc).map((o) => o.x).sort((p, q) => p - q);
    // strictly increasing left-to-right positions
    expect(xs[0]).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
  });

  it('decodes the file for its size and caps the placement (TC-17, TC-06 via flow)', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useImageInsert(args));
    act(() => result.current.onDrop(dropEvent([imageFile('big.png', 'image/png', 4000, 3000)])));
    await waitFor(() => expect(objectsSnapshot(args.doc).length).toBe(1));
    const obj = objectsSnapshot(args.doc)[0]!;
    expect(obj.width).toBe(800); // the 4000px long side capped at the placement max
    expect(obj.height).toBe(600);
  });
});

describe('useImageInsert paste (TC-18)', () => {
  it('pastes an image centred on the view, not at the cursor', async () => {
    const args = makeArgs({ viewport: { width: 1000, height: 800 } });
    const { result } = renderHook(() => useImageInsert(args));
    act(() => result.current.onPaste(pasteEvent([imageFile('clip.png', 'image/png', 200, 100)])));
    await waitFor(() => expect(objectsSnapshot(args.doc).length).toBe(1));
    const obj = objectsSnapshot(args.doc)[0]!;
    // the view centre is world (500, 400); a 200x100 image centred there starts at 400,350
    expect(obj.x).toBe(400);
    expect(obj.y).toBe(350);
  });

  it('ignores a paste with no image files', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useImageInsert(args));
    let prevented = false;
    act(() =>
      result.current.onPaste({ clipboardData: { files: [] }, preventDefault: () => (prevented = true) }),
    );
    await Promise.resolve();
    expect(objectsSnapshot(args.doc).length).toBe(0);
    expect(prevented).toBe(false);
  });

  it('leaves an image in the clipboard alone while a text editor has focus (TC-18)', async () => {
    // Pasting an image while typing in a sticky or a text block must not put it on the
    // board: the keys belong to the editor (image.paste).
    const box = document.createElement('textarea');
    document.body.append(box);
    box.focus();
    const args = makeArgs();
    const { result } = renderHook(() => useImageInsert(args));
    act(() => result.current.onPaste(pasteEvent([imageFile('clip.png')])));
    await Promise.resolve();
    expect(objectsSnapshot(args.doc).length).toBe(0);
    expect(upload.calls).toBe(0);
    box.remove();
  });
});

describe('useImageInsert offline gate (TC-19)', () => {
  it('adds nothing and toasts when the board is reconnecting', async () => {
    const args = makeArgs({ connection: 'reconnecting' });
    const { result } = renderHook(() => useImageInsert(args));
    act(() => result.current.onDrop(dropEvent([imageFile('photo.png')])));
    await Promise.resolve();
    expect(objectsSnapshot(args.doc).length).toBe(0); // nothing added (image.offline)
    expect(upload.calls).toBe(0); // the upload was never even attempted
    expect(result.current.toasts).toContain(REJECTION_MESSAGES.offline);
  });

  it('adds nothing while still connecting', () => {
    const args = makeArgs({ connection: 'connecting' });
    const { result } = renderHook(() => useImageInsert(args));
    act(() => result.current.onDrop(dropEvent([imageFile('photo.png')])));
    expect(objectsSnapshot(args.doc).length).toBe(0);
    expect(upload.calls).toBe(0);
  });
});

describe('useImageInsert upload outcomes (TC-20)', () => {
  it('a rate-limited upload leaves a failed image and the rate toast', async () => {
    upload.impl = () => ({ kind: 'rate_limited' });
    const args = makeArgs();
    const { result } = renderHook(() => useImageInsert(args));
    act(() => result.current.onPickerChange({ target: { files: [imageFile('p.png')], value: '' } } as unknown as React.ChangeEvent<HTMLInputElement>));
    await waitFor(() => expect(objectsSnapshot(args.doc).length).toBe(1));
    await waitFor(() => {
      const obj = objectsSnapshot(args.doc)[0];
      expect(isImageSnapshot(obj) && obj.status).toBe('failed');
    });
    expect(result.current.toasts).toContain(REJECTION_MESSAGES.rate);
    // the uploader can retry, because the File is still held in memory
    expect(result.current.canRetry(objectsSnapshot(args.doc)[0]!.id)).toBe(true);
  });

  it('a network failure leaves a failed image and no rate toast', async () => {
    upload.impl = () => ({ kind: 'failed' });
    const args = makeArgs();
    const { result } = renderHook(() => useImageInsert(args));
    act(() => result.current.onDrop(dropEvent([imageFile('p.png')])));
    await waitFor(() => {
      const obj = objectsSnapshot(args.doc)[0];
      expect(isImageSnapshot(obj) && obj.status).toBe('failed');
    });
    expect(result.current.toasts).not.toContain(REJECTION_MESSAGES.rate);
  });

  it('retry re-uploads the same file and turns it ready', async () => {
    upload.impl = () => ({ kind: 'failed' });
    const args = makeArgs();
    const { result } = renderHook(() => useImageInsert(args));
    act(() => result.current.onDrop(dropEvent([imageFile('p.png')])));
    await waitFor(() => {
      const obj = objectsSnapshot(args.doc)[0];
      expect(isImageSnapshot(obj) && obj.status).toBe('failed');
    });
    const id = objectsSnapshot(args.doc)[0]!.id;

    // now the retry succeeds
    upload.impl = () => ({ kind: 'ok', assetKey: 'abcdefghij0123456789AB/zzzzzzzzzzzzzzzzzzzzzzz' });
    const before = upload.calls;
    expect(result.current.retry(id)).toBe(true);
    await waitFor(() => expect(upload.calls).toBeGreaterThan(before));
    await waitFor(() => {
      const obj = objectsSnapshot(args.doc)[0];
      expect(isImageSnapshot(obj) && obj.status).toBe('ready');
    });
    expect(isImageSnapshot(objectsSnapshot(args.doc)[0]!) && (objectsSnapshot(args.doc)[0] as { assetKey: string }).assetKey).toBe(
      'abcdefghij0123456789AB/zzzzzzzzzzzzzzzzzzzzzzz',
    );
  });
});

describe('useImageInsert mixed-batch validation (TC-29 flow)', () => {
  it('adds the valid files and toasts the reason for the invalid ones', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useImageInsert(args));
    const good = imageFile('ok.png');
    const svg = imageFile('bad.svg', 'image/svg+xml');
    act(() => result.current.onDrop(dropEvent([good, svg])));
    await waitFor(() => expect(objectsSnapshot(args.doc).length).toBe(1)); // only the png landed
    expect(result.current.toasts).toContain(REJECTION_MESSAGES.type);
  });

  it('an image that will not decode is refused with the type message', async () => {
    const args = makeArgs();
    const { result } = renderHook(() => useImageInsert(args));
    // A file whose decoder rejects (a corrupt "png"): nothing is placed, the type
    // message is shown, and no upload is attempted for it.
    vi.stubGlobal('createImageBitmap', () => Promise.reject(new Error('corrupt')));
    act(() => result.current.onDrop(dropEvent([imageFile('corrupt.png')])));
    await waitFor(() => expect(result.current.toasts).toContain(REJECTION_MESSAGES.type));
    expect(objectsSnapshot(args.doc).length).toBe(0);
    expect(upload.calls).toBe(0);
  });
});
