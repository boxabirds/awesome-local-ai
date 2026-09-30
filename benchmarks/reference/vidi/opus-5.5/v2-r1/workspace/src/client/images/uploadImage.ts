// Image upload over XHR (story 12): fetch cannot report upload progress.

export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

/**
 * POSTs `file` to the board's assets. `onProgress` receives the sent fraction (0..1). A 201 with
 * an asset key is `ok`; any other answer or a network error is `failed` (with the HTTP status
 * when there was one). `abort()` ends the upload as failed.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve) => {
    xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
    };
    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          const body = JSON.parse(xhr.responseText) as { assetKey?: unknown };
          if (typeof body.assetKey === 'string') {
            onProgress(1);
            resolve({ kind: 'ok', assetKey: body.assetKey });
            return;
          }
        } catch {
          // Not JSON: treated as a failure below.
        }
      }
      resolve({ kind: 'failed', status: xhr.status });
    };
    xhr.onerror = () => resolve({ kind: 'failed' });
    xhr.onabort = () => resolve({ kind: 'failed' });
    xhr.ontimeout = () => resolve({ kind: 'failed' });
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
