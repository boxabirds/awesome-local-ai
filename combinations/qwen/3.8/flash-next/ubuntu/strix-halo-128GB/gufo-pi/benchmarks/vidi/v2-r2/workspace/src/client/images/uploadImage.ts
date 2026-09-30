/**
 * Upload a file to the board's assets endpoint using XHR (for upload progress events).
 */
export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();

  const promise = new Promise<UploadResult>((resolve) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 201) {
        try {
          const data = JSON.parse(xhr.responseText) as { assetKey: string };
          resolve({ kind: 'ok', assetKey: data.assetKey });
        } catch {
          resolve({ kind: 'failed', status: xhr.status });
        }
      } else {
        resolve({ kind: 'failed', status: xhr.status });
      }
    });

    xhr.addEventListener('error', () => {
      resolve({ kind: 'failed' });
    });

    xhr.addEventListener('abort', () => {
      resolve({ kind: 'failed' });
    });

    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.send(file);
  });

  return {
    promise,
    abort() {
      xhr.abort();
    },
  };
}
