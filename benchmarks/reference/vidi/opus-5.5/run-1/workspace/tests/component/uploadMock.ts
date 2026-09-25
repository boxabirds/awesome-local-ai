/**
 * The mocked uploadImage for story 12 component tests. Kept free of app imports so it can be
 * loaded from a `vi.mock` factory:
 *
 *   vi.mock('../../src/client/images/uploadImage', async () => {
 *     const { mockUpload } = await import('./uploadMock');
 *     return { uploadImage: vi.fn(mockUpload) };
 *   });
 */
import { act } from '@testing-library/react';
import type { UploadResult } from '../../src/client/images/uploadImage';

/** One call of the mocked uploadImage, controllable by the test. */
export interface UploadCall {
  boardId: string;
  file: File;
  progress(fraction: number): void;
  resolve(result: UploadResult): Promise<void>;
  aborted: boolean;
}

export const uploads: UploadCall[] = [];

/** Implementation for `vi.mock('../../src/client/images/uploadImage')`. */
export function mockUpload(boardId: string, file: File, onProgress: (f: number) => void) {
  let settle: (r: UploadResult) => void = () => undefined;
  const promise = new Promise<UploadResult>((r) => {
    settle = r;
  });
  const call: UploadCall = {
    boardId,
    file,
    aborted: false,
    progress: (f) => act(() => onProgress(f)),
    resolve: async (result) => {
      await act(async () => {
        settle(result);
        await promise;
      });
    },
  };
  uploads.push(call);
  return {
    promise,
    abort: () => {
      call.aborted = true;
    },
  };
}

