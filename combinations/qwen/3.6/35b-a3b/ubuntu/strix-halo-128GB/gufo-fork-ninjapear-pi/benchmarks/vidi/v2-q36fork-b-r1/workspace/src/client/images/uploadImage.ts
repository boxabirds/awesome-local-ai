/**
 * Story 12 — Image upload via XMLHttpRequest (for progress events).
 */

export type UploadResultOk = { kind: 'ok'; assetKey: string };
export type UploadResultFailed = { kind: 'failed'; status?: number };
export type UploadResult = UploadResultOk | UploadResultFailed;

export interface UploadImageCallbacks {
  onProgress: (fraction: number) => void;
}

export class UploadHandle {
  private xhr: XMLHttpRequest | null = null;
  private abortCalled = false;
  private resolvePromise: ((value: UploadResult) => void) | null = null;
  private rejectPromise: ((reason?: unknown) => void) | null = null;

  readonly promise: Promise<UploadResult>;

  constructor(
    boardId: string,
    file: File,
    callbacks: UploadImageCallbacks,
  ) {
    this.promise = new Promise<UploadResult>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;

      const xhr = new XMLHttpRequest();
      this.xhr = xhr;

      xhr.open('POST', `/api/boards/${boardId}/assets`);
      // Don't set Content-Type — let the browser set it with boundary for multipart;
      // the server reads Content-Length first and ignores Content-Type for decisions.

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && callbacks.onProgress) {
          callbacks.onProgress(e.loaded / e.total);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const body = JSON.parse(xhr.responseText);
            if (body.assetKey) {
              resolve({ kind: 'ok', assetKey: body.assetKey });
            } else {
              resolve({ kind: 'failed' });
            }
          } catch {
            resolve({ kind: 'failed' });
          }
        } else {
          resolve({ kind: 'failed', status: xhr.status });
        }
      });

      xhr.addEventListener('error', () => {
        resolve({ kind: 'failed' });
      });

      xhr.addEventListener('timeout', () => {
        resolve({ kind: 'failed' });
      });

      // Send without any explicit Content-Type so the browser sets multipart/form-data
      xhr.send(file);
    });
  }

  /** Abort the in-flight request. */
  abort(): void {
    this.abortCalled = true;
    this.xhr?.abort();
  }

  isAborted(): boolean {
    return this.abortCalled;
  }
}

/**
 * Start an upload of `file` to the boards API. Returns a handle with a
 * promise that resolves when complete and an abort method.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  return new UploadHandle(boardId, file, { onProgress });
}
