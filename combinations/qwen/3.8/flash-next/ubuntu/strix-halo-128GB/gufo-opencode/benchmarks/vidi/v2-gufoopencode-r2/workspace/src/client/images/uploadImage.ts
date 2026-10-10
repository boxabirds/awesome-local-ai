// Story 12: one image upload over XHR (fetch cannot report upload progress).
// 201 resolves with the server-confirmed {assetKey, contentType}; everything
// else (4xx/5xx, network failure, abort) rejects with an UploadError.

export interface UploadedAsset {
  assetKey: string;
  contentType: string;
}

export class UploadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'UploadError';
    this.status = status;
  }
}

export function uploadImage(
  boardId: string,
  file: Blob,
  onProgress?: (percent: number) => void,
): Promise<UploadedAsset> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable && e.total > 0) {
        onProgress?.(Math.min(100, Math.round((e.loaded / e.total) * 100)));
      }
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 201) {
        try {
          resolve(JSON.parse(xhr.responseText) as UploadedAsset);
          return;
        } catch {
          reject(new UploadError('upload returned an invalid response', xhr.status));
          return;
        }
      }
      reject(new UploadError(`upload failed with status ${xhr.status}`, xhr.status));
    });
    xhr.addEventListener('error', () => reject(new UploadError('network error', 0)));
    xhr.addEventListener('abort', () => reject(new UploadError('upload aborted', 0)));
    xhr.send(file);
  });
}
