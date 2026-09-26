/**
 * Story 12 — image upload with progress (image.insert, image.uploading).
 *
 * Uses XMLHttpRequest (not fetch) because the spec requires upload progress
 * events (fetch has no upload-progress API). The POST body is the raw file
 * bytes; the worker decides the type from CONTENT, so the Content-Type the
 * browser derives from the File is irrelevant to the outcome.
 *
 * Result mapping (design):
 *  - 201 → `{ kind: 'ok', assetKey }`
 *  - 429 → `{ kind: 'rate_limited' }`
 *  - any other status, a network error or an abort → `{ kind: 'failed', status }`
 *
 * The returned handle exposes `promise` and `abort()` (to cancel a stray
 * upload, e.g. on unmount).
 */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/**
 * Test hook (test-mode only): when set, the NEXT uploadImage call sends the
 * worker's `x-test-fail-asset-put` header, so the storage PUT is forced to
 * fail once (the retry then succeeds). Mirrors the worker's TEST_HOOKS check.
 */
let nextUploadFail = false;
export function setNextUploadFail(on: boolean): void {
  nextUploadFail = on;
}

export function uploadImage(boardId: string, file: File, onProgress: (fraction: number) => void): UploadHandle {
  const xhr = new XMLHttpRequest();
  let settled = false;

  const promise = new Promise<UploadResult>((resolve) => {
    const finish = (r: UploadResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    xhr.open('POST', `/api/boards/${boardId}/assets`);
    if (nextUploadFail) {
      nextUploadFail = false;
      xhr.setRequestHeader('x-test-fail-asset-put', '1');
    }
    xhr.responseType = 'text';
    xhr.timeout = 120_000;

    xhr.upload.onprogress = (e: ProgressEvent): void => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = (): void => {
      if (xhr.status === 201) {
        let assetKey: string | undefined;
        try {
          assetKey = (JSON.parse(xhr.responseText) as { assetKey?: string }).assetKey;
        } catch {
          /* malformed success body */
        }
        if (typeof assetKey === 'string' && assetKey.length > 0) {
          onProgress(1);
          finish({ kind: 'ok', assetKey });
        } else {
          finish({ kind: 'failed', status: xhr.status });
        }
        return;
      }
      if (xhr.status === 429) {
        finish({ kind: 'rate_limited' });
        return;
      }
      finish({ kind: 'failed', status: xhr.status });
    };
    xhr.onerror = (): void => finish({ kind: 'failed', status: 0 });
    xhr.ontimeout = (): void => finish({ kind: 'failed', status: 0 });
    xhr.onabort = (): void => finish({ kind: 'failed', status: 0 });

    try {
      xhr.send(file);
    } catch {
      finish({ kind: 'failed', status: 0 });
    }
  });

  return {
    promise,
    abort(): void {
      try {
        xhr.abort();
      } catch {
        /* already finished */
      }
    },
  };
}
