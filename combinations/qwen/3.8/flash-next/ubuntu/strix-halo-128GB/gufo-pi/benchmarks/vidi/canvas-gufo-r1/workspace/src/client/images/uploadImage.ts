export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/**
 * Upload a file to the asset endpoint using XHR for upload progress.
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
          const body = JSON.parse(xhr.responseText) as { assetKey: string };
          resolve({ kind: 'ok', assetKey: body.assetKey });
        } catch {
          resolve({ kind: 'failed', status: xhr.status });
        }
      } else if (xhr.status === 429) {
        resolve({ kind: 'rate_limited' });
      } else {
        resolve({ kind: 'failed', status: xhr.status });
      }
    });

    xhr.addEventListener('error', () => {
      if (!aborted) resolve({ kind: 'failed' });
    });

    xhr.addEventListener('abort', () => {
      resolve({ kind: 'failed' });
    });

    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
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
