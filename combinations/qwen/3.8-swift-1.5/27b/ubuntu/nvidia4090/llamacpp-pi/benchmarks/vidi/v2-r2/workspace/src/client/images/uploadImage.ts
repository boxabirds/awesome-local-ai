export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

/**
 * Uploads an image file to the board's assets endpoint using XMLHttpRequest
 * (needed for upload progress events that fetch doesn't support).
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void
): { promise: Promise<UploadResult>; abort(): void } {
  let xhr: XMLHttpRequest | null = null;

  const promise = new Promise<UploadResult>((resolve) => {
    xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded / e.total);
      }
    };
    xhr.onload = () => {
      if (xhr!.status === 201) {
        try {
          const body = JSON.parse(xhr!.response) as { assetKey: string };
          resolve({ kind: 'ok', assetKey: body.assetKey });
        } catch {
          resolve({ kind: 'failed', status: xhr!.status });
        }
      } else {
        resolve({ kind: 'failed', status: xhr!.status });
      }
    };
    xhr.onerror = () => {
      resolve({ kind: 'failed' });
    };
    xhr.send(file);
  });

  return {
    promise,
    abort() {
      xhr?.abort();
    },
  };
}
