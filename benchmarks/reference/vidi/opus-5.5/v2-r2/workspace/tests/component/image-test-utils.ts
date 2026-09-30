// Shared test doubles for story 12 component tests.
import { vi } from 'vitest';
import type { UploadResult } from '../../src/client/images/uploadImage';

export interface FakeUpload {
  boardId: string;
  file: File;
  onProgress(fraction: number): void;
  resolve(result: UploadResult): void;
  abort: ReturnType<typeof vi.fn>;
}

/** Natural sizes returned by the stubbed createImageBitmap, by file name; other names fail to decode. */
export function stubCreateImageBitmap(sizes: Record<string, { width: number; height: number }>) {
  const fn = vi.fn(async (file: File) => {
    const size = sizes[file.name];
    if (!size) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
    return { ...size, close: () => {} };
  });
  vi.stubGlobal('createImageBitmap', fn);
  return fn;
}

export function imageFile(name: string, type = 'image/png', bytes = 64): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

/** A DataTransfer-like init for fireEvent drag/drop/paste. */
export function filesTransfer(files: File[]) {
  return { files, types: ['Files'], items: files.map((f) => ({ kind: 'file', type: f.type })), dropEffect: 'none' };
}
