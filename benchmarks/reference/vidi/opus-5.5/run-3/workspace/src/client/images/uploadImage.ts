// Uploads one image file to the board's asset store with progress (story 12). XMLHttpRequest, because fetch cannot
// report upload progress.

export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'rate_limited' } | { kind: 'failed'; status?: number };

/**
 * POSTs the file's bytes to /api/boards/:boardId/assets. `onProgress` gets the fraction sent (0..1). The promise
 * never rejects: 201 → ok, 429 → rate_limited, any other status, a network error or abort → failed.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve) => {
    xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          const body = JSON.parse(xhr.responseText) as { assetKey?: unknown };
          if (typeof body.assetKey === 'string') {
            onProgress(1);
            resolve({ kind: 'ok', assetKey: body.assetKey });
            return;
          }
        } catch {
          // fall through: an unreadable success is a failure
        }
        resolve({ kind: 'failed', status: xhr.status });
      } else if (xhr.status === 429) {
        resolve({ kind: 'rate_limited' });
      } else {
        resolve({ kind: 'failed', status: xhr.status });
      }
    };
    xhr.onerror = () => resolve({ kind: 'failed' });
    xhr.onabort = () => resolve({ kind: 'failed' });
    xhr.ontimeout = () => resolve({ kind: 'failed' });
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
