export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

const CREATED = 201;

/**
 * Uploads one image file to the board (POST /api/boards/:id/assets). XHR, not
 * fetch, because only XHR reports upload progress (`onProgress` gets 0…1).
 * 201 → ok with the stored asset key; any other answer, a network error or an
 * abort → failed. Never rejects.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve) => {
    xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      if (xhr.status !== CREATED) return resolve({ kind: 'failed', status: xhr.status });
      try {
        const body = JSON.parse(xhr.responseText) as { assetKey?: unknown };
        if (typeof body.assetKey === 'string') {
          onProgress(1);
          return resolve({ kind: 'ok', assetKey: body.assetKey });
        }
      } catch {
        // fall through: an unreadable answer is a failure
      }
      resolve({ kind: 'failed', status: xhr.status });
    };
    xhr.onerror = () => resolve({ kind: 'failed' });
    xhr.onabort = () => resolve({ kind: 'failed' });
    xhr.ontimeout = () => resolve({ kind: 'failed' });
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
