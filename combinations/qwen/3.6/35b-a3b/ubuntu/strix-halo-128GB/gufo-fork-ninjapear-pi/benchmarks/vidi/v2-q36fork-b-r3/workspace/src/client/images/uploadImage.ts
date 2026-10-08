/** XHR-based image upload for story 12 */

export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

/**
 * Upload a single file to /api/boards/:boardId/assets via XMLHttpRequest.
 * Returns an object with a promise and an abort method.
 * onProgress receives a fraction (0–1) as the upload progresses.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();
  let settled = false;

  function settle(result: UploadResult): void {
    if (settled) return;
    settled = true;
    (result as any)._resolve?.(result);
  }

  const promise = new Promise<UploadResult>((resolve) => {
    (promise as any)._resolve = resolve;
  });

  xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
  // Do not set Content-Type — server should ignore it for decisions

  xhr.upload.onprogress = (evt: ProgressEvent) => {
    if (evt.lengthComputable && evt.total > 0) {
      onProgress(evt.loaded / evt.total);
    }
  };

  xhr.onload = () => {
    if (xhr.status === 201 || xhr.status === 200) {
      try {
        const data = JSON.parse(xhr.responseText);
        settle({ kind: 'ok', assetKey: data.assetKey });
      } catch {
        settle({ kind: 'failed', status: xhr.status });
      }
    } else {
      settle({ kind: 'failed', status: xhr.status });
    }
  };

  xhr.onerror = () => {
    settle({ kind: 'failed' });
  };

  xhr.ontimeout = () => {
    settle({ kind: 'failed', status: xhr.status || 0 });
  };

  xhr.send(file);

  return {
    promise,
    abort() {
      if (!settled) {
        xhr.abort();
        settle({ kind: 'failed' });
      }
    },
  };
}
