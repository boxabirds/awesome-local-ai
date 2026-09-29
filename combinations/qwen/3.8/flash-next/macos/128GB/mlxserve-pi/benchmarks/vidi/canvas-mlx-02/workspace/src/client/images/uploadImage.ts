// One image, put on the server, with honest progress (story 12, design
// `image.insert`). It uses XMLHttpRequest rather than fetch on purpose: fetch
// reports NO upload progress in any browser, and "a progress bar that never moves
// is worse than none" (image.uploading) - so this is the one place that reaches for
// the older API.
//
// The result is mapped to exactly the outcomes the insert flow branches on: `ok`
// (a 201 with a key), `rate_limited` (a 429), or `failed` (any other status, a
// network error, or an abort). It never throws - a rejected upload is an answer,
// not an exception - and it hands back an `abort()` so a retry can cancel an upload
// still in flight.
/**
 * What an upload was able to say: a key, a rate limit, or a failure (with the
 * HTTP status when there was one, absent for a network error or an abort).
 */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status?: number };

const ENDPOINT = (boardId: string): string => `/api/boards/${encodeURIComponent(boardId)}/assets`;

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/**
 * Upload `file` to `boardId`'s asset store, calling `onProgress(fraction 0..1)` as
 * the bytes go out. Resolves with the mapped result; never rejects.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  let settled = false;

  const promise = new Promise<UploadResult>((resolve) => {
    xhr.upload.addEventListener('progress', (e: ProgressEvent) => {
      const total = e.lengthComputable && e.total > 0 ? e.total : file.size;
      if (total > 0) onProgress(Math.min(1, e.loaded / total));
    });

    xhr.addEventListener('load', () => {
      settled = true;
      if (xhr.status === 201) {
        let assetKey: unknown;
        try {
          assetKey = (JSON.parse(xhr.responseText) as { assetKey?: unknown }).assetKey;
        } catch {
          assetKey = undefined;
        }
        if (typeof assetKey === 'string' && assetKey !== '') {
          onProgress(1);
          resolve({ kind: 'ok', assetKey });
        } else {
          // A 201 whose body we cannot read is not a stored image we can trust.
          resolve({ kind: 'failed', status: xhr.status });
        }
        return;
      }
      if (xhr.status === 429) {
        resolve({ kind: 'rate_limited' });
        return;
      }
      resolve({ kind: 'failed', status: xhr.status });
    });

    // A network failure, a blocked request and an abort all land here: no status,
    // just "it did not work" (image.upload_failure shows "Upload failed").
    xhr.addEventListener('error', () => {
      if (settled) return;
      settled = true;
      resolve({ kind: 'failed' });
    });
    xhr.addEventListener('abort', () => {
      if (settled) return;
      settled = true;
      resolve({ kind: 'failed' });
    });

    xhr.open('POST', ENDPOINT(boardId));
    // The raw bytes; the server ignores this header for its decision and sniffs.
    xhr.send(file);
  });

  return {
    promise,
    abort() {
      if (!settled) xhr.abort();
    },
  };
}
