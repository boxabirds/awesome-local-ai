/**
 * Story 12 (image.insert): the XHR image upload.
 *
 * XHR (not fetch) because the uploader's placeholder shows real progress:
 * fetch has no upload-progress API. The worker decides the stored type from
 * magic bytes; the client Content-Type is never sent at all.
 *
 * A failure (any non-201, network error or timeout) resolves — it never
 * rejects — as { kind: 'failed' }, so callers can settle the placeholder
 * either way.
 */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const xhr = new XMLHttpRequest();
  xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
  xhr.responseType = 'text';
  xhr.upload.onprogress = (e: ProgressEvent) => {
    if (e.lengthComputable && e.total > 0) onProgress(Math.min(1, e.loaded / e.total));
  };
  let settled = false;
  const promise = new Promise<UploadResult>((resolve) => {
    const settle = (r: UploadResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          const body = JSON.parse(xhr.responseText) as { assetKey?: unknown };
          if (typeof body.assetKey === 'string' && body.assetKey.length > 0) {
            settle({ kind: 'ok', assetKey: body.assetKey });
            return;
          }
        } catch {
          // fall through to failed
        }
      }
      settle({ kind: 'failed', status: xhr.status });
    };
    xhr.onerror = () => settle({ kind: 'failed' });
    xhr.ontimeout = () => settle({ kind: 'failed' });
    xhr.onabort = () => settle({ kind: 'failed' });
  });
  xhr.send(file);
  return {
    promise,
    abort(): void {
      if (!settled) xhr.abort();
    },
  };
}
