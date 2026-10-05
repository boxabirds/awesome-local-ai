/**
 * XHR image upload (story 12, image.insert). XMLHttpRequest (not fetch)
 * because it reports upload progress via `upload.onprogress`.
 *
 * POST /api/boards/:boardId/assets with the raw file body. 201 →
 * `{ kind: 'ok', assetKey }`; any other status or a network error →
 * `{ kind: 'failed', status? }`. Never throws.
 */

export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  let xhr: XMLHttpRequest | null = null;
  const promise = new Promise<UploadResult>((resolve) => {
    xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr && xhr.status === 201) {
        try {
          const body = JSON.parse(xhr.responseText) as { assetKey: string };
          resolve({ kind: 'ok', assetKey: body.assetKey });
        } catch {
          resolve({ kind: 'failed', status: xhr.status });
        }
        return;
      }
      resolve({ kind: 'failed', status: xhr?.status });
    };
    xhr.onerror = () => resolve({ kind: 'failed' });
    xhr.onabort = () => resolve({ kind: 'failed' });
    xhr.send(file);
  });
  return {
    promise,
    abort() {
      xhr?.abort();
    },
  };
}
