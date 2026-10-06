/**
 * Upload an image via XHR with progress reporting.
 *
 * XHR is used instead of fetch because fetch does not support upload progress events.
 */

export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/**
 * Upload a file to the board's asset endpoint.
 * Returns a promise that resolves when the upload completes and an abort method.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void
): UploadHandle {
  const xhr = new XMLHttpRequest();
  const url = `/api/boards/${boardId}/assets`;

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

    xhr.open('POST', url);
    xhr.send(file);
  });

  return {
    promise,
    abort() {
      xhr.abort();
    }
  };
}
