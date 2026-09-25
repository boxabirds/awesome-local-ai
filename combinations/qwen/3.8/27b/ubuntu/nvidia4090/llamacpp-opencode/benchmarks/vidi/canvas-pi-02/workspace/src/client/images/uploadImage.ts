/**
 * XHR-based image upload (story 12, image.insert).
 *
 * Uses XMLHttpRequest (not fetch) because XHR supports upload progress
 * events. The POST is sent to /api/boards/:boardId/assets with the raw
 * file bytes as the body.
 *
 * Response mapping:
 *  - 201 → { kind: 'ok', assetKey }
 *  - 429 → { kind: 'rate_limited' }
 *  - anything else (404, 413, 415, 500, network error) → { kind: 'failed', status? }
 */

export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/**
 * Upload an image file to the board's asset endpoint.
 *
 * @param boardId - the board id (from the URL)
 * @param file - the file to upload
 * @param onProgress - called with a fraction (0..1) as upload progress events fire
 * @returns a handle with a promise and an abort method
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
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
          const body = JSON.parse(xhr!.responseText) as { assetKey: string };
          resolve({ kind: 'ok', assetKey: body.assetKey });
        } catch {
          resolve({ kind: 'failed', status: 201 });
        }
      } else if (xhr!.status === 429) {
        resolve({ kind: 'rate_limited' });
      } else {
        resolve({ kind: 'failed', status: xhr!.status });
      }
    };

    xhr.onerror = () => {
      resolve({ kind: 'failed' });
    };

    xhr.ontimeout = () => {
      resolve({ kind: 'failed' });
    };

    xhr.send(file);
  });

  return {
    promise,
    abort() {
      if (xhr !== null) xhr.abort();
    },
  };
}
