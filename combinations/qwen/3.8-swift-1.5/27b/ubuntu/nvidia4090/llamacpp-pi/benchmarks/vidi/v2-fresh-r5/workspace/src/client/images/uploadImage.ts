/**
 * XHR-based image upload with progress (story 12).
 * Uses XMLHttpRequest because fetch lacks upload progress events.
 */

export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

/**
 * Upload a file to the board's asset endpoint.
 * Returns a promise that resolves with the result, and an abort function.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  let xhr: XMLHttpRequest | null = null;
  let resolved = false;

  const promise = new Promise<UploadResult>((resolve) => {
    xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    };
    xhr.onload = () => {
      if (resolved) return;
      resolved = true;
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
      if (resolved) return;
      resolved = true;
      resolve({ kind: 'failed' });
    };
    xhr.send(file);
  });

  return {
    promise,
    abort() {
      if (xhr && !resolved) {
        resolved = true;
        xhr.abort();
      }
    },
  };
}
