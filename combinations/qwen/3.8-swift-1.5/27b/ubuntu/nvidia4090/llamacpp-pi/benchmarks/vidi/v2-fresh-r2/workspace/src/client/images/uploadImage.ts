/**
 * Image upload over XHR (story 12, image.insert).
 *
 * XHR is used (not fetch) because it exposes per-file upload progress via
 * `upload.onprogress`. The Promise always resolves:
 * - `{ kind: 'ok', assetKey }` on 201;
 * - `{ kind: 'failed', status? }` on any other status, a network error, or an
 *   abort.
 *
 * `abort()` cancels the in-flight request.
 */

export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/**
 * Upload `file` to the board's asset endpoint, reporting progress as a
 * fraction in [0, 1].
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  let xhr: XMLHttpRequest | null = null;

  const promise = new Promise<UploadResult>((resolve) => {
    xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.responseType = 'text';
    xhr.upload.onprogress = (e: ProgressEvent) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress(e.loaded / e.total);
      }
    };
    xhr.onload = () => {
      if (xhr && xhr.status === 201) {
        try {
          const body = JSON.parse(xhr.responseText) as { assetKey: string };
          resolve({ kind: 'ok', assetKey: body.assetKey });
        } catch {
          resolve({ kind: 'failed', status: xhr.status });
        }
      } else if (xhr) {
        resolve({ kind: 'failed', status: xhr.status });
      }
    };
    xhr.onerror = () => resolve({ kind: 'failed' });
    xhr.onabort = () => resolve({ kind: 'failed' });
    xhr.send(file);
  });

  return {
    promise,
    abort: () => {
      xhr?.abort();
    },
  };
}
