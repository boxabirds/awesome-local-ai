export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

/**
 * Upload a file to the board's asset endpoint via XHR.
 * Progress is reported via onProgress callback (0..1).
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();
  let aborted = false;

  const url = `/api/boards/${encodeURIComponent(boardId)}/assets`;

  xhr.open('POST', url);

  // Do not set Content-Type — server ignores it for decisions
  xhr.responseType = 'json';

  xhr.upload.onprogress = (event) => {
    if (event.lengthComputable && event.total > 0) {
      onProgress(event.loaded / event.total);
    }
  };

  xhr.onerror = () => {
    if (!aborted) {
      resolve({ kind: 'failed' });
    }
  };

  xhr.onload = () => {
    if (aborted) return;
    if (xhr.status === 201 || xhr.status === 200) {
      try {
        const resp = JSON.parse(xhr.responseText) as { assetKey?: string };
        if (resp.assetKey) {
          resolve({ kind: 'ok', assetKey: resp.assetKey });
        } else {
          resolve({ kind: 'failed' });
        }
      } catch {
        resolve({ kind: 'failed' });
      }
    } else {
      resolve({ kind: 'failed', status: xhr.status });
    }
  };

  function resolve(result: UploadResult): void {
    aborted = true;
    pendingResolve(result);
  }

  let pendingResolve: (r: UploadResult) => void;
  const promise = new Promise<UploadResult>((resolve) => {
    pendingResolve = resolve;
  });

  xhr.send(file);

  return {
    promise,
    abort() {
      aborted = true;
      xhr.abort();
    },
  };
}
