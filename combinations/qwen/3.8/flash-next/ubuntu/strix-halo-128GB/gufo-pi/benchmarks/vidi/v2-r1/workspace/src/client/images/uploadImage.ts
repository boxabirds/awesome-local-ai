/**
 * XHR-based image upload with byte-progress reporting (story 12).
 */

/**
 * Upload image bytes to the server.
 * Returns the assetKey on success, rejects on failure.
 * Reports progress via onProgress(loaded, total).
 */
export function uploadImage(
  boardId: string,
  bytes: Blob | ArrayBuffer,
  onProgress: (loaded: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ assetKey: string; contentType: string }> {
  const url = `/api/boards/${encodeURIComponent(boardId)}/assets`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(e.loaded, e.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status === 413) {
        reject(new Error('size'));
        return;
      }
      if (xhr.status === 415) {
        reject(new Error('type'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const resp = JSON.parse(xhr.responseText);
          resolve(resp);
        } catch {
          reject(new Error('parse_error'));
        }
        return;
      }
      if (xhr.status === 0) {
        // Network error (offline)
        reject(new Error('offline'));
        return;
      }
      reject(new Error(`http_${xhr.status}`));
    };

    xhr.onerror = () => {
      reject(new Error('offline'));
    };

    xhr.ontimeout = () => {
      reject(new Error('timeout'));
    };

    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort();
        reject(new Error('aborted'));
      });
    }

    xhr.send(bytes);
  });
}
