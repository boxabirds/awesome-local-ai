/**
 * Story 12: XHR-based image upload with progress reporting.
 *
 * fetch() lacks upload progress events, so XMLHttpRequest is used.
 * Returns a promise for the result and an abort function.
 */

export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

/**
 * Upload a file to the board's asset endpoint.
 *
 * @param boardId - The board to upload to
 * @param file - The file to upload
 * @param onProgress - Called with a 0–1 fraction as upload progresses
 * @returns An object with a `promise` resolving to the result and an `abort()` function.
 */
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
          const body = JSON.parse(xhr.responseText) as { assetKey: string };
          resolve({ kind: 'ok', assetKey: body.assetKey });
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

    xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.send(file);
  });

  return { promise, abort: () => xhr.abort() };
}
