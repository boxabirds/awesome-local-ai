// Image upload (see spec: image.insert).
//
// XHR rather than fetch: XMLHttpRequest.upload.onprogress is the only
// standard way to report upload progress to the uploader (image.uploading).
// Result mapping (design): 201 → ok (assetKey + contentType), 429 →
// rate_limited, anything else → failed. Nothing is thrown.

export type UploadResult =
  | { kind: 'ok'; assetKey: string; contentType: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  /** Abort the in-flight request (no-op once settled). */
  abort(): void;
}

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
    xhr.upload.onprogress = (e) => {
      if (e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr!.status === 201) {
        try {
          const body = JSON.parse(xhr!.response) as { assetKey?: string; contentType?: string };
          if (typeof body.assetKey === 'string' && typeof body.contentType === 'string') {
            resolve({ kind: 'ok', assetKey: body.assetKey, contentType: body.contentType });
            return;
          }
        } catch {
          // fall through to failed
        }
        resolve({ kind: 'failed', status: 201 });
        return;
      }
      if (xhr!.status === 429) {
        resolve({ kind: 'rate_limited' });
        return;
      }
      resolve({ kind: 'failed', status: xhr!.status });
    };
    xhr.onerror = () => resolve({ kind: 'failed' });
    xhr.send(file);
  });
  return {
    promise,
    abort() {
      xhr?.abort();
    },
  };
}
