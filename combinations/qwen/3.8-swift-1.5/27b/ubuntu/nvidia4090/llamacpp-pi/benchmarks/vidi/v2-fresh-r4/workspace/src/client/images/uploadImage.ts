/**
 * XHR-based image upload with progress (story 12).
 * Uses XMLHttpRequest because fetch lacks upload progress events.
 */

export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/**
 * Upload an image file to the board's assets endpoint.
 * POST /api/boards/:boardId/assets with the raw file body.
 *
 * Reports progress as a fraction (0..1) via onProgress.
 * Returns a handle with the result promise and an abort() function.
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

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      if (xhr!.status === 201) {
        try {
          const body = JSON.parse(xhr!.responseText) as { assetKey: string };
          resolve({ kind: 'ok', assetKey: body.assetKey });
        } catch {
          resolve({ kind: 'failed', status: 500 });
        }
      } else {
        resolve({ kind: 'failed', status: xhr!.status });
      }
    };

    xhr.onerror = () => {
      resolve({ kind: 'failed' });
    };

    xhr.send(file);
  });

  return {
    promise,
    abort() {
      xhr?.abort();
    },
  };
}
