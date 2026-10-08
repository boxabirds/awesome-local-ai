// Image upload (story 12, image.insert): POST the file's bytes to the asset
// route with XHR (fetch lacks upload progress), reporting the progress
// fraction as the XHR reports it. Network/abort failures and non-201
// responses are outcomes, never thrown.

export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const xhr = new XMLHttpRequest();
  let settled = false;
  const promise = new Promise<UploadResult>((resolve) => {
    const done = (r: UploadResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 201) {
        try {
          const body = JSON.parse(xhr.responseText) as { assetKey?: unknown };
          if (typeof body.assetKey === 'string') {
            done({ kind: 'ok', assetKey: body.assetKey });
            return;
          }
        } catch {
          // malformed 201 body: treat as failed
        }
      }
      done({ kind: 'failed', status: xhr.status });
    };
    xhr.onerror = () => done({ kind: 'failed' });
    xhr.onabort = () => done({ kind: 'failed' });
    xhr.send(file);
  });
  return {
    promise,
    abort: () => {
      xhr.abort();
    },
  };
}
