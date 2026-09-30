/**
 * Story 12: useImageInsert component tests (TC-17, TC-19, TC-29).
 *
 * Real Y.Doc; the upload and decode functions are injected so the test
 * exercises the hook's orchestration (placeholders → upload → status,
 * toasts, retry) without a browser image decoder or network. Upload
 * promises are resolved manually so the intermediate 'uploading' state is
 * observable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, snapshot } from '@shared/board-model';
import { useImageInsert, type UseImageInsertResult } from '@client/images/useImageInsert';
import type { DecodedImage, UploadFn } from '@client/images/uploadImage';
import type { ImageSnap } from '@shared/objects/image';

function pngFile(name = 'a.png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });
}

const okDecode: (file: File) => Promise<DecodedImage> = vi.fn(async (file: File) => ({
  width: 100,
  height: 50,
  blob: file,
  contentType: file.type,
}));

interface HarnessProps {
  doc: Y.Doc;
  boardId: string;
  onToast: (m: string) => void;
  uploadFn: UploadFn;
  decode?: (file: File) => Promise<DecodedImage>;
  run: (api: UseImageInsertResult) => void;
}

function Harness({ doc, boardId, onToast, uploadFn, decode, run }: HarnessProps): null {
  const api = useImageInsert({ doc, boardId, onToast, uploadFn, decodeFn: decode });
  run(api);
  return null;
}

let api: UseImageInsertResult;

/**
 * An uploadFn whose promises resolve/reject through `settle(i, ok, key?)`
 * in call order.
 */
function controllableUpload() {
  const calls: { resolve: (k: string) => void; reject: (e: unknown) => void }[] = [];
  const impl: UploadFn = (_boardId: string, _blob: Blob, onProgress?: (p: number) => void) => {
    onProgress?.(0.5);
    return new Promise<string>((resolve, reject) => {
      calls.push({ resolve, reject });
    });
  };
  const fn = vi.fn(impl);
  const settle = (i: number, ok: boolean, key = `boardid123456789012345/${'a'.repeat(22)}`) => {
    if (ok) calls[i].resolve(key);
    else calls[i].reject(new Error('injected failure'));
  };
  return { fn, settle };
}

function renderHarness(
  uploadFn: UploadFn,
  toasts: string[],
  decode: (file: File) => Promise<DecodedImage> = okDecode,
) {
  const doc = new Y.Doc();
  initDoc(doc);
  render(
    <Harness
      doc={doc}
      boardId='boardid123456789012345'
      onToast={(m) => toasts.push(m)}
      uploadFn={uploadFn}
      decode={decode}
      run={(a) => { api = a; }}
    />,
  );
  return { doc, toasts };
}

describe('TC-17: useImageInsert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('two files → two uploading placeholders, then both ready with asset keys', async () => {
    const toasts: string[] = [];
    const { fn, settle } = controllableUpload();
    const { doc } = renderHarness(fn, toasts);

    await act(async () => {
      api.addFilesAt([pngFile('a.png'), pngFile('b.png')], { x: 10, y: 20 });
    });

    // Both placeholders exist immediately, in uploading state.
    let snaps = snapshot(doc);
    expect(snaps).toHaveLength(2);
    for (const s of snaps) {
      const img = s as ImageSnap;
      expect(img.type).toBe('image');
      expect(img.status).toBe('uploading');
      expect(img.assetKey).toBeNull();
      expect(img.uploaderId).toBe(String(doc.clientID));
    }
    // Both uploads were attempted (progress was reported).
    expect(fn).toHaveBeenCalledTimes(2);

    // Settle both uploads → ready with asset keys.
    await act(async () => {
      settle(0, true);
      settle(1, true);
    });
    snaps = snapshot(doc);
    expect(snaps).toHaveLength(2);
    for (const s of snaps) {
      const img = s as ImageSnap;
      expect(img.status).toBe('ready');
      expect(img.assetKey).toBe(`boardid123456789012345/${'a'.repeat(22)}`);
    }
    expect(toasts).toHaveLength(0);
  });

  it('one upload fails → the other is ready, the failed one is failed + toast; retry recovers it', async () => {
    const toasts: string[] = [];
    const { fn, settle } = controllableUpload();
    const { doc } = renderHarness(fn, toasts);

    await act(async () => {
      api.addFilesAt([pngFile('ok.png'), pngFile('bad.png')], { x: 0, y: 0 });
    });

    expect(fn).toHaveBeenCalledTimes(2);

    // First succeeds, second fails.
    await act(async () => {
      settle(0, true);
      settle(1, false);
    });

    let snaps = snapshot(doc);
    expect(snaps).toHaveLength(2);
    const ready = snaps.filter((s) => (s as ImageSnap).status === 'ready');
    const failed = snaps.filter((s) => (s as ImageSnap).status === 'failed');
    expect(ready).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(toasts).toContain('Some images couldn\'t be uploaded.');

    // The failed id is exposed for the retry button.
    const failedId = (failed[0] as ImageSnap).id;
    expect(api.failedIds.has(failedId)).toBe(true);

    // Retry re-enters the upload flow and recovers.
    await act(async () => {
      api.retryImage(failedId);
    });
    expect(fn).toHaveBeenCalledTimes(3);
    await act(async () => {
      settle(2, true);
    });

    snaps = snapshot(doc);
    expect(snaps.every((s) => (s as ImageSnap).status === 'ready')).toBe(true);
    expect(api.failedIds.has(failedId)).toBe(false);
  });

  it('TC-19: offline → toast, no placeholders, no upload (negative)', async () => {
    const toasts: string[] = [];
    const { fn } = controllableUpload();
    const original = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      const { doc } = renderHarness(fn, toasts);
      await act(async () => {
        api.addFilesAt([pngFile('a.png')], { x: 0, y: 0 });
      });
      expect(snapshot(doc)).toHaveLength(0);
      expect(fn).toHaveBeenCalledTimes(0);
      expect(toasts).toEqual(["You're offline — images can be added when you reconnect."]);
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: original, configurable: true });
    }
  });

  it('TC-29: decode rejects for a corrupt file → type toast, no placeholder (error path)', async () => {
    const toasts: string[] = [];
    const { fn } = controllableUpload();
    const failingDecode = async (_file: File): Promise<DecodedImage> => {
      throw new Error('corrupt');
    };
    const { doc } = renderHarness(fn, toasts, failingDecode);

    await act(async () => {
      api.addFilesAt([pngFile('corrupt.png')], { x: 0, y: 0 });
    });
    expect(snapshot(doc)).toHaveLength(0);
    expect(fn).toHaveBeenCalledTimes(0);
    expect(toasts).toContain('Only PNG, JPEG, GIF and WebP images can be added.');
  });
});
