export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

/**
 * Upload an image file via XHR (fetch lacks upload progress).
 * POSTs the raw file body to /api/boards/:boardId/assets.
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
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    };
    xhr.onload = () => {
      if (xhr!.status === 201) {
        try {
          const body = JSON.parse(xhr!.response) as { assetKey: string };
          resolve({ kind: 'ok', assetKey: body.assetKey });
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
    xhr.send(file);
  });

  return {
    promise,
    abort() {
      xhr?.abort();
    },
  };
}
