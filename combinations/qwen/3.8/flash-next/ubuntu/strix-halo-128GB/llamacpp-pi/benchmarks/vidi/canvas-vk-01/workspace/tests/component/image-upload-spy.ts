import { act } from '@testing-library/react';

/**
 * The one boundary story 12's client tests replace: the network.
 *
 * It lives in its own module because it is the body of a `vi.mock` factory, which
 * runs while the application is still being imported — anything it pulled in
 * would be pulled into that import cycle.
 */

/** A promise the test resolves by hand. */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((fulfil, fail) => {
    resolve = fulfil;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** One upload the test is watching, as `uploadImage` hands it over. */
export interface UploadCall {
  boardId: string;
  file: File;
  progress(fraction: number): void;
  resolve(result: unknown): void;
  readonly aborted: boolean;
}

export interface UploadSpy {
  calls: UploadCall[];
  /** Report upload progress and settle it, both inside `act`. */
  emit(call: UploadCall, fraction: number): void;
  settle(call: UploadCall, result: unknown): Promise<void>;
  reset(): void;
}

/**
 * Replace `uploadImage` with a recording stand-in. The module boundary is the
 * network and nothing else, so progress, success, 429 and failure are all the
 * test's to decide.
 */
export const uploadSpy: UploadSpy = {
  calls: [],
  emit(call, fraction) {
    const entry = call as UploadCallInternal;
    act(() => {
      entry.onProgress(fraction);
    });
  },
  async settle(call, result) {
    const entry = call as UploadCallInternal;
    await act(async () => {
      entry.resolve(result);
      await Promise.resolve();
      await Promise.resolve();
    });
  },
  reset() {
    this.calls.length = 0;
  },
};

interface UploadCallInternal extends UploadCall {
  onProgress(fraction: number): void;
  resolve(result: unknown): void;
  abort(): void;
  aborted: boolean;
}

/** The `vi.mock` factory body for `src/client/images/uploadImage`. */
export function uploadImageMock(): {
  uploadImage(
    boardId: string,
    file: File,
    onProgress: (fraction: number) => void,
  ): { promise: Promise<unknown>; abort(): void };
  assetsUrl(boardId: string): string;
} {
  return {
    uploadImage(boardId, file, onProgress) {
      const settle = deferred<unknown>();
      const entry: UploadCallInternal = {
        boardId,
        file,
        onProgress,
        aborted: false,
        abort() {
          entry.aborted = true;
        },
        resolve: (result: unknown) => settle.resolve(result),
        progress: (fraction: number) => onProgress(fraction),
      };
      uploadSpy.calls.push(entry);
      return { promise: settle.promise, abort: () => entry.abort() };
    },
    assetsUrl: (boardId: string) => `/api/boards/${boardId}/assets`,
  };
}

