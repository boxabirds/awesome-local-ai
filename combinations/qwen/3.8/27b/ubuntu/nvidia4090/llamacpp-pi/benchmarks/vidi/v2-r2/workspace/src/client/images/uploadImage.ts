/**
 * XHR-based image upload with progress (story 12, image.insert).
 *
 * Uses XMLHttpRequest (not fetch) because XHR provides upload progress
 * events. POSTs the file to /api/boards/:boardId/assets and maps the
 * response to UploadResult.
 */

import { IMAGE_MAX_BYTES } from '../../shared/config';

/** The result of an upload attempt. */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

/**
 * Uploads a file to the asset API.
 *
 * Returns a handle with the upload promise and an abort() method.
 * `onProgress` is called with a fraction (0..1) as upload progress events fire.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  let xhr: XMLHttpRequest | null = null;

  const promise = new Promise<UploadResult>((resolve) => {
    xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/boards/${boardId}/assets`);

    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      if (xhr!.status === 201) {
        try {
          const body = JSON.parse(xhr!.response) as { assetKey: string };
          resolve({ kind: 'ok', assetKey: body.assetKey });
        } catch {
          resolve({ kind: 'failed', status: 201 });
        }
      } else {
        resolve({ kind: 'failed', status: xhr!.status });
      }
    };

    xhr.onerror = () => {
      resolve({ kind: 'failed' });
    };

    xhr.onabort = () => {
      resolve({ kind: 'failed' });
    };

    xhr.send(file);
  });

  return {
    promise,
    abort(): void {
      xhr?.abort();
    },
  };
}
