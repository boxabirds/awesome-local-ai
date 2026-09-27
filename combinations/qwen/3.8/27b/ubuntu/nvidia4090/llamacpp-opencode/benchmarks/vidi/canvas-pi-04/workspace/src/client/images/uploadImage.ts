// Story 12: XHR image upload with progress (anchor: image.insert).
//
// fetch() cannot report upload progress, so the uploader uses XMLHttpRequest:
// `upload.onprogress` feeds a 0..1 fraction to the placeholder's progress bar
// (image.uploading). The raw file is POSTed to the worker's assets route; the
// server decides type (sniffing) and size, and returns 201 { assetKey } on
// success. 429 maps to `rate_limited`; any other status or a network error
// maps to `failed` (image.upload_failure / image.rate_limit).
//
// `abort()` stops an in-flight upload (e.g. on unmount); the promise resolves
// `failed` so it never hangs.

export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  /** Stop an in-flight upload; the promise settles as `failed`. */
  abort(): void;
}

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  let xhr: XMLHttpRequest | null = null;
  const promise = new Promise<UploadResult>((resolve) => {
    const x = new XMLHttpRequest();
    xhr = x;
    x.open('POST', `/api/boards/${boardId}/assets`);
    x.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    const finish = (status: number): void => {
      if (status === 201) {
        try {
          const body = JSON.parse(x.responseText) as { assetKey?: string };
          if (typeof body.assetKey === 'string') {
            resolve({ kind: 'ok', assetKey: body.assetKey });
            return;
          }
        } catch {
          // fall through to failed
        }
        resolve({ kind: 'failed', status });
        return;
      }
      if (status === 429) {
        resolve({ kind: 'rate_limited' });
        return;
      }
      resolve({ kind: 'failed', status });
    };
    x.onload = () => finish(x.status);
    x.onerror = () => resolve({ kind: 'failed' });
    x.onabort = () => resolve({ kind: 'failed' });
    x.send(file);
  });
  return {
    promise,
    abort(): void {
      if (xhr !== null) xhr.abort();
    },
  };
}
