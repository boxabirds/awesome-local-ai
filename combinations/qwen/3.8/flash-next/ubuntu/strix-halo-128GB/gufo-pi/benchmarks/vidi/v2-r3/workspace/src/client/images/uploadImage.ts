/**
 * XHR-based image upload with progress (story 12).
 */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/**
 * Upload a file to the server with XHR (fetch lacks upload progress events).
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
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
    xhr.setRequestHeader('Content-Type', file.type);
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
