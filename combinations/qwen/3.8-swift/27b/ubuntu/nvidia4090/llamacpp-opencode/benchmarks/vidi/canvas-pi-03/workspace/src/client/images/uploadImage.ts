/**
 * Story 12: the image upload request (assets.api client side).
 *
 * POSTs the file to `/api/boards/:boardId/assets` with XMLHttpRequest so the
 * caller gets byte-level upload progress (`xhr.upload.progress` → fraction).
 * The result is resolved (never rejected):
 *   201 → { kind: 'ok', assetKey }
 *   429 → { kind: 'rate_limited' }
 *   415 → { kind: 'failed', status: 415 } (server sniff rejected the content;
 *         the hook maps this to the "unsupported type" toast)
 *   anything else / network error / abort → { kind: 'failed', status? }
 */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  /** Aborts the in-flight request (no result is produced on abort). */
  abort(): void;
}

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  let settled = false;

  const promise = new Promise<UploadResult>((resolve) => {
    xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    });
    xhr.addEventListener('load', () => {
      settled = true;
      if (xhr!.status === 201) {
        try {
          const body = JSON.parse(xhr!.responseText) as { assetKey?: string };
          if (typeof body.assetKey === 'string') {
            resolve({ kind: 'ok', assetKey: body.assetKey });
            return;
          }
        } catch {
          /* fall through to failed */
        }
        resolve({ kind: 'failed', status: 201 });
      } else if (xhr!.status === 429) {
        resolve({ kind: 'rate_limited' });
      } else {
        resolve({ kind: 'failed', status: xhr!.status });
      }
    });
    xhr.addEventListener('error', () => {
      settled = true;
      resolve({ kind: 'failed' });
    });
    xhr.addEventListener('abort', () => {
      settled = true;
      resolve({ kind: 'failed' });
    });
    xhr.send(file);
  });

  return {
    promise,
    abort() {
      if (!settled && xhr) xhr.abort();
    },
  };
}
