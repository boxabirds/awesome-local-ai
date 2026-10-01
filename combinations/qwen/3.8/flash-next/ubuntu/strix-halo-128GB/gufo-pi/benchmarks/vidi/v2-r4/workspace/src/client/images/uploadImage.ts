/**
 * XHR-based image upload with progress reporting.
 * fetch() lacks upload progress events, so we use XMLHttpRequest.
 */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();
  let aborted = false;

  const promise = new Promise<UploadResult>((resolve) => {
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    });

    xhr.addEventListener('load', () => {
      if (aborted) return;
      if (xhr.status === 201) {
        try {
          const data = JSON.parse(xhr.responseText);
          resolve({ kind: 'ok', assetKey: data.assetKey });
        } catch {
          resolve({ kind: 'failed', status: xhr.status });
        }
      } else {
        resolve({ kind: 'failed', status: xhr.status });
      }
    });

    xhr.addEventListener('error', () => {
      if (aborted) return;
      resolve({ kind: 'failed' });
    });

    xhr.addEventListener('abort', () => {
      resolve({ kind: 'failed' });
    });

    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.send(file);
  });

  return {
    promise,
    abort() {
      aborted = true;
      xhr.abort();
    },
  };
}
