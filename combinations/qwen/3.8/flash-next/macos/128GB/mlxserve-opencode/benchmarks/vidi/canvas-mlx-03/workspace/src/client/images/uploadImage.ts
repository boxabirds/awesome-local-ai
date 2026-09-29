// One file, on its way to the board (story 12).
//
// XMLHttpRequest rather than fetch, for one reason: a placeholder has to show how far the
// upload has got *while it is still going*, and fetch reports nothing about the request body
// until it is finished. Everything else here is about the shape of the answer — every outcome,
// including the ones that look like errors, comes back as a value. An exception from an upload
// would stop the other files in the same drop from ever being spoken about again, and the
// board has to be able to say something about each of them.

import { uploadUrl } from '../api.ts';

/**
 * What an upload ended as.
 *
 * `rate_limited` is separated from `failed` because it is the one failure with a different
 * sentence and a different waiting: the file is fine, the board is not taking any more of
 * them right now.
 */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'rate_limited' }
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  /** Gives up on this upload. The promise still settles, as a failure. */
  abort(): void;
}

/** The fraction of the file that has been handed over, kept inside 0…1 whatever says otherwise. */
function fractionOf(loaded: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.max(0, Math.min(1, loaded / total));
}

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void = () => {},
): UploadHandle {
  const request = new XMLHttpRequest();
  let aborted = false;

  const promise = new Promise<UploadResult>((resolve) => {
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(fractionOf(event.loaded, event.total));
    });

    request.addEventListener('load', () => {
      if (request.status === 201) {
        // The address is the only thing worth having from a successful upload, and it is the
        // server's to invent. A 201 that does not carry one is not a success.
        try {
          const body = JSON.parse(request.responseText) as { assetKey?: unknown };
          if (typeof body.assetKey === 'string' && body.assetKey.length > 0) {
            resolve({ kind: 'ok', assetKey: body.assetKey });
            return;
          }
        } catch {
          // fall through to the failure below
        }
        resolve({ kind: 'failed', status: request.status });
        return;
      }
      if (request.status === 429) {
        resolve({ kind: 'rate_limited' });
        return;
      }
      resolve({ kind: 'failed', status: request.status });
    });

    // No answer at all: the network gave up, or this did.
    request.addEventListener('error', () => resolve({ kind: 'failed' }));
    request.addEventListener('timeout', () => resolve({ kind: 'failed' }));
    request.addEventListener('abort', () => resolve({ kind: 'failed' }));

    request.open('POST', uploadUrl(boardId), true);
    // The file's own type, which the browser took from the file itself, is sent as a courtesy.
    // The board decides what a file is from its bytes and ignores this.
    if (file.type) request.setRequestHeader('Content-Type', file.type);
    request.send(file);
  });

  return {
    promise,
    abort() {
      if (aborted) return;
      aborted = true;
      request.abort();
    },
  };
}
