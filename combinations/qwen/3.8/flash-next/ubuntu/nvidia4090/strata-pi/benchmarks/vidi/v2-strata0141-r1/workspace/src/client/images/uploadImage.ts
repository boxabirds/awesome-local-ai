import { ASSET_UPLOAD_SUFFIX, BOARD_API_PREFIX, IMAGE_MAX_BYTES } from '../../shared/config';

/**
 * One file, sent once (`image.insert`).
 *
 * `XMLHttpRequest` and not `fetch`, for one reason: this app needs to say how much
 * of a 9 MB file has left the browser, and only XHR reports progress on a request
 * body. Everything else about it is unremarkable - a POST of the file's own bytes
 * to the board's asset route, and a response read for its `assetKey`.
 *
 * The call does not await. Whoever called it has already put a placeholder on the
 * board, and that placeholder's state is what a person is looking at while the
 * bytes are moving; the promise is how the placeholder is told it is finished.
 * `abort()` is what `image.remove` uses, so taking an object off the board does not
 * leave a file being stored for an object that no longer exists.
 */

export type UploadResult =
  | { kind: 'ok'; assetKey: string; contentType?: string }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/** `POST /api/boards/:boardId/assets` (`assets.api`). */
export function uploadUrlFor(boardId: string): string {
  return `${BOARD_API_PREFIX}/${encodeURIComponent(boardId)}${ASSET_UPLOAD_SUFFIX}`;
}

interface UploadBody {
  ok?: boolean;
  assetKey?: unknown;
  contentType?: unknown;
  error?: unknown;
}

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void = () => undefined,
): UploadHandle {
  const request = new XMLHttpRequest();
  let settled = false;

  const promise = new Promise<UploadResult>((resolve) => {
    // `validateFiles` has already measured this file. Measuring it again here costs
    // nothing and is the last place a number this client can trust is checked
    // before a stranger's board is asked to hold it (`image.size_limit`).
    if (file.size > IMAGE_MAX_BYTES) {
      resolve({ kind: 'failed', status: 413 });
      return;
    }

    request.open('POST', uploadUrlFor(boardId));
    request.responseType = 'json';

    request.upload.onprogress = (event: ProgressEvent) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, Math.max(0, event.loaded / event.total)));
      }
    };

    request.onload = () => {
      settled = true;
      const body = request.response as UploadBody | null;
      const assetKey = body && typeof body.assetKey === 'string' ? body.assetKey : null;
      if (assetKey !== null && request.status >= 200 && request.status < 300) {
        resolve({
          kind: 'ok',
          assetKey,
          contentType: typeof body?.contentType === 'string' ? body.contentType : undefined,
        });
        return;
      }
      // Any other answer - 404, 413, 415, 500, or a proxy that returned an HTML
      // error page - is one failure with a number attached, which is all
      // `image.failed` needs to show Retry rather than a permanent placeholder.
      resolve({ kind: 'failed', status: request.status });
    };

    // No status at all: the network refused the request, or the board went away
    // while the file was in transit.
    request.onerror = () => {
      settled = true;
      resolve({ kind: 'failed' });
    };
    request.ontimeout = () => {
      settled = true;
      resolve({ kind: 'failed' });
    };
    request.onabort = () => {
      settled = true;
      resolve({ kind: 'failed' });
    };

    request.send(file);
  });

  return {
    promise,
    abort() {
      if (!settled) {
        request.abort();
      }
    },
  };
}
