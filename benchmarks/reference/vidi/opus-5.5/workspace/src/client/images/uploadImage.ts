/**
 * Uploads one image file to the board's asset API (story 12). XMLHttpRequest, because fetch
 * reports no upload progress. Never throws or rejects: every outcome is a value.
 */
export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'rate_limited' } | { kind: 'failed'; status?: number };

const HTTP_CREATED = 201;
const HTTP_TOO_MANY_REQUESTS = 429;

export function assetsUploadUrl(boardId: string): string {
  return `/api/boards/${encodeURIComponent(boardId)}/assets`;
}

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve) => {
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      if (xhr.status === HTTP_TOO_MANY_REQUESTS) return resolve({ kind: 'rate_limited' });
      if (xhr.status !== HTTP_CREATED) return resolve({ kind: 'failed', status: xhr.status });
      try {
        const body = JSON.parse(xhr.responseText) as { assetKey?: unknown };
        if (typeof body.assetKey === 'string') return resolve({ kind: 'ok', assetKey: body.assetKey });
      } catch {
        // Malformed answer: treated as a failure below.
      }
      resolve({ kind: 'failed', status: xhr.status });
    };
    xhr.onerror = () => resolve({ kind: 'failed' });
    xhr.onabort = () => resolve({ kind: 'failed' });
    xhr.ontimeout = () => resolve({ kind: 'failed' });
    try {
      xhr.open('POST', assetsUploadUrl(boardId));
      xhr.send(file);
    } catch {
      resolve({ kind: 'failed' });
    }
  });
  return { promise, abort: () => xhr.abort() };
}
