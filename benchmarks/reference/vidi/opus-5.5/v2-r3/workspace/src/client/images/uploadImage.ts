// One image upload (story 12, image.insert). XMLHttpRequest rather than fetch:
// only XHR reports upload progress.
import { isAssetKey } from '../../shared/image-format';

export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

const CREATED = 201;

/**
 * POSTs the file's bytes to the board's asset route. `onProgress` gets the
 * fraction sent (0–1). Never rejects: any status but 201 with a valid key, a
 * network error or an abort resolves as failed.
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
      if (xhr.status !== CREATED) {
        resolve({ kind: 'failed', status: xhr.status });
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as { assetKey?: unknown };
        if (isAssetKey(body.assetKey)) {
          onProgress(1);
          resolve({ kind: 'ok', assetKey: body.assetKey });
          return;
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
