export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

/** POSTs the raw file with XHR (fetch has no upload progress); never rejects. */
export function uploadImage(
  boardId: string, file: File, onProgress: (fraction: number) => void,
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
            resolve({ kind: 'ok', assetKey: body.assetKey });
            return;
          }
        } catch { /* fall through to failed */ }
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
