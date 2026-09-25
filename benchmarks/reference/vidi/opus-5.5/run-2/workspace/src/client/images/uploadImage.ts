/**
 * Uploads one image file (anchor: image.insert). XMLHttpRequest rather than fetch, because
 * only XHR reports upload progress. The raw file is the body; the Worker decides the type
 * from its content. Never throws: every outcome is an UploadResult.
 */
import { ASSET_KEY_PATTERN } from '../../shared/image-format';

export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'rate_limited' } | { kind: 'failed'; status?: number };

const CREATED = 201;
const TOO_MANY_REQUESTS = 429;

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve) => {
    xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      if (xhr.status === TOO_MANY_REQUESTS) return resolve({ kind: 'rate_limited' });
      if (xhr.status !== CREATED) return resolve({ kind: 'failed', status: xhr.status });
      try {
        const body = JSON.parse(String(xhr.responseText)) as { assetKey?: unknown };
        if (typeof body.assetKey === 'string' && ASSET_KEY_PATTERN.test(body.assetKey)) {
          onProgress(1);
          return resolve({ kind: 'ok', assetKey: body.assetKey });
        }
      } catch {
        // fall through: an unreadable answer is a failure
      }
      return resolve({ kind: 'failed', status: xhr.status });
    };
    xhr.onerror = () => resolve({ kind: 'failed' });
    xhr.onabort = () => resolve({ kind: 'failed' });
    xhr.ontimeout = () => resolve({ kind: 'failed' });
    try {
      xhr.send(file);
    } catch {
      resolve({ kind: 'failed' });
    }
  });
  return { promise, abort: () => xhr.abort() };
}
