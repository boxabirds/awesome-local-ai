/**
 * Uploading one image, with progress (`image.upload_progress`).
 *
 * `fetch` cannot report how much of the request body has left, and a user
 * watching a 10 MB picture needs exactly that, so this is `XMLHttpRequest` —
 * `upload.onprogress` is the reason it still exists. `abort()` is the other
 * reason: a batch that is undone should stop travelling.
 *
 * The reply is never thrown on: an upload that failed is data the caller turns
 * into a failed state, not an exception in a promise chain nobody catches.
 */

/** What the asset API made of one file. */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  /** Give up on this upload. The promise resolves as failed. */
  abort(): void;
}

/** Where a board's images are stored — the same origin, as everything else. */
export const assetsUrl = (boardId: string): string => `/api/boards/${boardId}/assets`;

/**
 * Send `file` to `boardId`'s asset collection, reporting the fraction of the body
 * that has left the browser as it goes.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const request = new XMLHttpRequest();
  let settled = false;
  const promise = new Promise<UploadResult>((resolve) => {
    const finish = (result: UploadResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    request.open('POST', assetsUrl(boardId));
    // The raw file is the body: no multipart wrapper, no declared type the
    // Worker would have to believe.
    request.responseType = 'text';
    request.upload.onprogress = (event: ProgressEvent) => {
      if (!Number.isFinite(event.total) || event.total <= 0) return;
      const fraction = event.loaded / event.total;
      onProgress(fraction < 0 ? 0 : fraction > 1 ? 1 : fraction);
    };
    request.onload = (): void => {
      if (request.status === 201) {
        const assetKey = readAssetKey(request.responseText);
        if (assetKey === null) {
          finish({ kind: 'failed', status: request.status });
          return;
        }
        finish({ kind: 'ok', assetKey });
        return;
      }
      if (request.status === 429) {
        finish({ kind: 'rate_limited' });
        return;
      }
      // 404, 413, 415, 5xx, and anything else: the object failed, and the reason
      // is the same to the user.
      finish({ kind: 'failed', status: request.status });
    };
    request.onerror = (): void => {
      finish({ kind: 'failed' });
    };
    request.ontimeout = (): void => {
      finish({ kind: 'failed' });
    };
    request.onabort = (): void => {
      finish({ kind: 'failed' });
    };
    request.send(file);
  });

  return {
    promise,
    abort(): void {
      if (settled) return;
      request.abort();
    },
  };
}

/** The `assetKey` of a 201 reply, or null when the body is not what was promised. */
function readAssetKey(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const key = (parsed as { assetKey?: unknown }).assetKey;
    return typeof key === 'string' && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}
