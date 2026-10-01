/**
 * XHR-based image upload (story 12). fetch has no upload-progress event, so
 * XMLHttpRequest is used to report `upload.onprogress` as a 0..1 fraction.
 */
export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

export function uploadImage(boardId: string, file: File, onProgress: (fraction: number) => void): UploadHandle {
  let aborted = false;
  let xhr: XMLHttpRequest | null = null;

  const promise = new Promise<UploadResult>((resolve) => {
    xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.responseType = 'text';

    xhr.upload.onprogress = (e) => {
      if (aborted) return;
      if (e.lengthComputable && e.total > 0) {
        onProgress(e.loaded / e.total);
      }
    };

    xhr.onload = () => {
      if (aborted) return;
      if (xhr!.status === 201) {
        try {
          const body = JSON.parse(xhr!.response) as { assetKey?: string };
          if (body.assetKey) {
            resolve({ kind: 'ok', assetKey: body.assetKey });
            return;
          }
        } catch {
          // fall through to failed
        }
      }
      resolve({ kind: 'failed', status: xhr!.status });
    };

    xhr.onerror = () => {
      if (!aborted) resolve({ kind: 'failed' });
    };

    xhr.onabort = () => {
      // abort() is a deliberate cancel; the caller handles it
    };

    const blob = new Blob([file], { type: file.type });
    xhr.send(blob);
  });

  return {
    promise,
    abort() {
      aborted = true;
      xhr?.abort();
    },
  };
}
