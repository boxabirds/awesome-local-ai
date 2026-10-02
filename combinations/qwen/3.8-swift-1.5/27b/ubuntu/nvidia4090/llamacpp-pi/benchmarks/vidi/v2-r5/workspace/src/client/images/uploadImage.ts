// src/client/images/uploadImage.ts
// XHR upload with progress tracking.

export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/**
 * Uploads a file to the asset API using XMLHttpRequest (for upload progress).
 * POST /api/boards/:boardId/assets
 */
export function uploadImage(boardId: string, file: File, onProgress: (fraction: number) => void): UploadHandle {
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
          const data = JSON.parse(xhr!.responseText);
          resolve({ kind: 'ok', assetKey: data.assetKey });
        } catch {
          resolve({ kind: 'failed', status: xhr!.status });
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
    abort() {
      xhr?.abort();
    },
  };
}
