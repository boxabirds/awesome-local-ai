export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

// XHR because fetch does not report upload progress (design image.insert).
// Never rejects: every outcome maps to an UploadResult, abort included.
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve) => {
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 201) {
        try {
          const body = JSON.parse(xhr.responseText) as { assetKey?: unknown };
          if (typeof body.assetKey === 'string') {
            resolve({ kind: 'ok', assetKey: body.assetKey });
            return;
          }
        } catch {
          // fall through
        }
      }
      resolve({ kind: 'failed', status: xhr.status });
    });
    xhr.addEventListener('error', () => resolve({ kind: 'failed' }));
    xhr.addEventListener('timeout', () => resolve({ kind: 'failed' }));
    xhr.addEventListener('abort', () => resolve({ kind: 'failed' }));
    xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
    xhr.send(file);
  });
  return { promise, abort: () => xhr.abort() };
}
