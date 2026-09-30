import { act, createEvent, fireEvent } from '@testing-library/react';
import { vi } from 'vitest';
import type * as Y from 'yjs';
import type { UploadResult } from '../../src/client/images/uploadImage';
import { objectsSnapshot } from '../../src/shared/board-model';
import type { ImageSnap } from '../../src/shared/objects/image';

export const imagesOf = (doc: Y.Doc) => objectsSnapshot(doc).filter((o): o is ImageSnap => o.type === 'image');

/** A file whose decoded size the createImageBitmap stub reports (see stubBitmaps). */
export function imageFile(name: string, width: number, height: number, type = 'image/png'): File {
  const file = new File([new Uint8Array([1, 2, 3])], name, { type });
  BITMAP_SIZES.set(file, { width, height });
  return file;
}

/** A file createImageBitmap cannot decode (corrupt image). */
export function corruptFile(name: string, type = 'image/png'): File {
  return new File([new Uint8Array([0])], name, { type });
}

const BITMAP_SIZES = new WeakMap<Blob, { width: number; height: number }>();

/** jsdom has no image decoding: createImageBitmap answers the fixture sizes, rejects otherwise. */
export function stubBitmaps() {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async (blob: Blob) => {
      const size = BITMAP_SIZES.get(blob);
      if (!size) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
      return { ...size, close() {} };
    }),
  );
}

/** One call of the mocked uploadImage, controllable from the test. */
export interface PendingUpload {
  boardId: string;
  file: File;
  progress(fraction: number): void;
  resolve(result: UploadResult): void;
  aborted: boolean;
}

/** Fake uploadImage implementation recording each call. */
export function fakeUploads() {
  const calls: PendingUpload[] = [];
  const impl = (boardId: string, file: File, onProgress: (f: number) => void) => {
    let resolve!: (r: UploadResult) => void;
    const promise = new Promise<UploadResult>((r) => (resolve = r));
    const call: PendingUpload = {
      boardId,
      file,
      aborted: false,
      progress: (f) => act(() => onProgress(f)),
      resolve: (r) => resolve(r),
    };
    calls.push(call);
    return {
      promise,
      abort() {
        call.aborted = true;
        resolve({ kind: 'failed' });
      },
    };
  };
  return { calls, impl };
}

/** Resolves an upload and lets React and the promise chain settle. */
export async function finish(call: PendingUpload, result: UploadResult) {
  await act(async () => {
    call.resolve(result);
    await Promise.resolve();
  });
}

function dataTransfer(files: File[]) {
  return { files, types: ['Files'], dropEffect: 'none', items: [] };
}

/** Drag files over `el` and drop them at a client point. */
export async function dropFiles(el: Element, files: File[], at: { x: number; y: number }) {
  for (const type of ['dragEnter', 'dragOver'] as const) {
    const e = createEvent[type](el, { dataTransfer: dataTransfer(files) });
    Object.defineProperties(e, { clientX: { value: at.x }, clientY: { value: at.y } });
    fireEvent(el, e);
  }
  const drop = createEvent.drop(el, { dataTransfer: dataTransfer(files) });
  Object.defineProperties(drop, { clientX: { value: at.x }, clientY: { value: at.y } });
  await act(async () => {
    fireEvent(el, drop);
    // createImageBitmap stubs resolve on microtasks.
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return drop;
}

/** A paste event carrying `files` on `target`. */
export async function pasteFiles(target: EventTarget, files: File[]) {
  const e = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'clipboardData', { value: { files, types: ['Files'], getData: () => '' } });
  await act(async () => {
    target.dispatchEvent(e);
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
  return e;
}
