// XHR-based image upload with progress tracking.
// Story 12. fetch lacks upload progress, so we use XMLHttpRequest.

export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

/**
 * Upload a file to the board's asset endpoint.
 * Returns a promise that resolves with the result, and an abort() function.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  let xhr: XMLHttpRequest | null = null;
  let aborted = false;

  const promise = new Promise<UploadResult>((resolve) => {
    xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.responseType = 'json';

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      if (aborted) return;
      if (xhr!.status === 201) {
        const body = xhr!.response as { assetKey: string };
        resolve({ kind: 'ok', assetKey: body.assetKey });
      } else {
        resolve({ kind: 'failed', status: xhr!.status });
      }
    };

    xhr.onerror = () => {
      if (aborted) return;
      resolve({ kind: 'failed' });
    };

    xhr.ontimeout = () => {
      if (aborted) return;
      resolve({ kind: 'failed' });
    };

    xhr.send(file);
  });

  return {
    promise,
    abort() {
      aborted = true;
      xhr?.abort();
    },
  };
}
