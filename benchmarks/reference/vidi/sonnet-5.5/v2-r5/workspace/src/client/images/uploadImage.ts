export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

const CREATED = 201;

/** XHR rather than fetch because only XHR reports upload progress. */
export function uploadImage(
  boardId: string, file: File, onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve) => {
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status !== CREATED) { resolve({ kind: 'failed', status: xhr.status }); return; }
      try {
        const body = JSON.parse(xhr.responseText) as { assetKey?: unknown };
        resolve(typeof body.assetKey === 'string' ? { kind: 'ok', assetKey: body.assetKey } : { kind: 'failed', status: xhr.status });
      } catch {
        resolve({ kind: 'failed', status: xhr.status });
      }
    };
    xhr.onerror = () => resolve({ kind: 'failed' });
    xhr.onabort = () => resolve({ kind: 'failed' });
    xhr.ontimeout = () => resolve({ kind: 'failed' });
    xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
