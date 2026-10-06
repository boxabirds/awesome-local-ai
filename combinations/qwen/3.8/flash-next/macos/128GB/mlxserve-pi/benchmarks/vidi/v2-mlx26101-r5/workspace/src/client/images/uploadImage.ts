/**
 * One file, sent to the bucket, with the byte count read on the way out.
 *
 * `fetch` can send this upload; what it cannot do is tell anybody how far it has got. Progress on a
 * request that is still in the browser's hands is not something a page can observe through `fetch` — there
 * is no event, no stream, no callback for the bytes the network layer has actually put on the wire — and
 * this story's promise is a *progress bar*: PRD `image.uploading` says the person who dropped the file sees
 * a percentage, and a percentage invented from elapsed time is a lie that also happens to be the exact
 * "uploads look like nothing is happening" this story exists against. `XMLHttpRequest` reports real upload
 * progress through `upload.onprogress`, so this upload is made with `XMLHttpRequest`.
 *
 * The shape of the return value is the part worth defending. It is not a promise and not a callback trail;
 * it is `{ promise, abort }` — one object, made once, that says how the upload is going and how to stop it.
 * A plain promise could not be aborted, and a promise with an `abort` hung off it would be a lie about what
 * a promise is. The promise *never rejects*: an upload that failed for any reason — no network, a 500, a
 * bucket that refused the write, a person who closed the tab — answers `{ kind: 'failed' }`, because there
 * is exactly one thing to do about each of those (mark the placeholder `failed`) and a caller that has to
 * catch is a caller that will someday forget to.
 *
 * The key comes back here and only here, and it is written into the placeholder that already exists on the
 * board. A retry that made a second object would put a second picture on the board for one file, which is
 * the duplicate this whole story exists to prevent.
 */

import { IMAGE_MAX_BYTES } from '../../shared/config';

/** How the upload went. There is no third answer: a failed upload is one problem, not five. */
export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

/** An upload in progress: the way to know how it is going, and the way to stop it. */
export interface ImageUpload {
  /** Settles once, with the outcome. Never rejects. */
  promise: Promise<UploadResult>;
  /** Stops the upload. The placeholder it was writing to is left as it is, for the caller to settle. */
  abort(): void;
}

/** Where a board's pictures are handed over. */
export function assetUploadUrl(boardId: string): string {
  return `/api/boards/${encodeURIComponent(boardId)}/assets`;
}

/** Where a stored picture is read back from — the `src` of every `<img>` this board draws. */
export function assetUrl(assetKey: string): string {
  return `/api/assets/${assetKey}`;
}

/**
 * Sends `file` to `boardId`'s shelf.
 *
 * `onProgress` is called with a fraction 0…1 as the bytes leave, and the last call before the response is
 * not necessarily 1: the server then reads the body, sniffs it and writes it, which is time in which the
 * upload is fully sent and still not finished. That is honest — the bar measures the sending, and the wait
 * after it belongs to the server.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): ImageUpload {
  let xhr: XMLHttpRequest | null = null;
  let settled = false;

  const promise = new Promise<UploadResult>((resolve) => {
    const settle = (result: UploadResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // A file this board has already promised not to add cannot be uploaded either; the Worker would answer
    // it with a 413, so the same failure is reported here without spending the bytes on it.
    if (file.size > IMAGE_MAX_BYTES) {
      settle({ kind: 'failed' });
      return;
    }

    const request = new XMLHttpRequest();
    xhr = request;
    request.open('POST', assetUploadUrl(boardId));
    // The byte count is a hint the server checks and does not believe; it is sent so that a body far too
    // large can be refused before it is read at all. `file` is sent as the raw body: one file per request,
    // no form, no field name, so the request body *is* the file.
    request.upload.addEventListener('progress', (event) => {
      if (event.total <= 0) return;
      onProgress(Math.min(1, event.loaded / event.total));
    });
    request.addEventListener('load', () => {
      if (request.status === 201) {
        const key = readAssetKey(request.response);
        if (key !== null) {
          settle({ kind: 'ok', assetKey: key });
          return;
        }
      }
      // Every other answer — 404 (no such board), 413, 415, 405, 500, a captive portal's 200 with HTML in
      // it — is one thing to the person waiting: this file did not get onto the board, and the only thing
      // they can do about it is try again. The status travels for whoever reads a console, not for the UI.
      settle({ kind: 'failed', status: request.status });
    });
    request.addEventListener('error', () => settle({ kind: 'failed' }));
    request.addEventListener('abort', () => settle({ kind: 'failed' }));
    request.send(file);
  });

  return {
    promise,
    abort() {
      // `abort()` fires the abort event, which settles it; this guard is for the upload that had already
      // finished and has nothing left to stop.
      if (settled) return;
      xhr?.abort();
    },
  };
}

/** The key the server gave back, or null when the body was not the answer we asked for. */
function readAssetKey(body: unknown): string | null {
  const text = typeof body === 'string' ? body : body instanceof ArrayBuffer ? new TextDecoder().decode(body) : '';
  if (text.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object') return null;
    const key = (parsed as { assetKey?: unknown }).assetKey;
    return typeof key === 'string' && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}
