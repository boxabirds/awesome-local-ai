// One file, put on the server, with the progress that a person is watching (story 12).
//
// This is an `XMLHttpRequest`, which in 2026 looks like a mistake. It is the only way to get upload
// progress in a browser: `fetch` reports download and nothing else, and image.uploading is a promise
// about a percentage moving while the bytes are in flight. Everything else about it is deliberately
// dull — one POST, one JSON answer, one result.
//
// What the progress number means is the part worth writing down. `upload.onprogress` says how much of
// the *request body* the browser has handed to the operating system, which is not how much of the
// picture the board has. After the last byte leaves, the Worker still has to read the file, look at
// its first bytes, and store it — and that is exactly the part of a slow request a person is waiting
// through. So progress is reported up to 0.99 and only reaches 1 when the server has answered (the
// caller then replaces the placeholder with the picture itself). A bar that pretended to be honest
// about the network would be a bar that stops moving at 96% for eight seconds.
//
// The result is never thrown and never a rejection: a failure is a fact about this file, not an
// exception to unwind through whoever called us. The caller writes `status: 'failed'` into the
// document and the picture says so on the board (image.upload_failure).

import { IMAGE_MAX_BYTES } from '../../shared/config';

/** What the server said about one upload. */
export type UploadResult =
  | { kind: 'ok'; assetKey: string; contentType: string }
  /** `status` is the HTTP code, or 0 for a request that never got an answer (offline, DNS, abort). */
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  /** Settles once, whatever happens. Never rejects. */
  promise: Promise<UploadResult>;
  /** Give up on the request. The promise settles as failed. Safe to call more than once. */
  abort(): void;
}

/** The progress a person is shown: never backwards, never a whole until the server has answered. */
export const UPLOAD_PROGRESS_CEILING = 0.99;

export function uploadProgress(
  loaded: number,
  total: number,
  previous: number,
  done = false,
): number {
  if (done) return 1;
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(loaded)) return previous;
  const fraction = Math.min(loaded / total, 1) * UPLOAD_PROGRESS_CEILING;
  // Bytes are sent in bursts and events arrive out of a smooth line; a bar that goes back one pixel
  // every so often reads as a bug in the board rather than a fact about the network.
  return Math.max(previous, fraction);
}

/**
 * Upload `file` to this board's asset endpoint.
 *
 * `onProgress` is called with a fraction in [0, 1] as the bytes leave, and is not called again once
 * the request has an answer — the caller replaces the placeholder with the picture at that point.
 */
export function uploadImage(
  boardId: string,
  file: File | Blob,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const request = new XMLHttpRequest();
  let fraction = 0;
  let settled: (result: UploadResult) => void = () => {};
  const promise = new Promise<UploadResult>((resolve) => {
    settled = resolve;
  });

  const report = (loaded: number, total: number, done = false): void => {
    const next = uploadProgress(loaded, total, fraction, done);
    if (next === fraction) return;
    fraction = next;
    onProgress(next);
  };

  request.upload.addEventListener('progress', (event) => {
    report(event.loaded, event.lengthComputable ? event.total : file.size);
  });

  request.addEventListener('loadend', () => {
    // Anything the server answered with that is not "stored" is a failure the board will show;
    // anything it did not answer with at all is the same, with no code attached.
    settled({ kind: 'failed', status: 0 });
  });

  const finish = (done: boolean): void => {
    if (!done) return;
    report(file.size, file.size, true);
  };

  request.addEventListener('load', () => {
    const status = request.status;
    if (status !== 201) {
      settled({ kind: 'failed', status });
      return;
    }
    const assetKey = readAssetKey(request.responseText);
    if (assetKey === null) {
      // A 201 that did not say where the picture went is a failure: writing a half-answer into the
      // document would leave a placeholder that points at nothing, forever, for everyone.
      settled({ kind: 'failed', status });
      return;
    }
    finish(true);
    settled({ kind: 'ok', assetKey, contentType: readContentType(request.responseText) });
  });

  request.addEventListener('error', () => settled({ kind: 'failed', status: 0 }));
  request.addEventListener('abort', () => settled({ kind: 'failed', status: 0 }));

  request.open('POST', `/api/boards/${encodeURIComponent(boardId)}/assets`);
  // The file's own claim about what it is, sent because a server may log it. It decides nothing: the
  // Worker reads the type out of the bytes and a lie comes back as 415 (image.types).
  const type = file.type || 'application/octet-stream';
  try {
    request.setRequestHeader('content-type', type);
  } catch {
    // A request that has already started cannot take a header. Nothing here starts one twice.
  }
  // An upload of ten megabytes over a bad line has no business being abandoned after thirty seconds,
  // and no business hanging forever either. The caller keeps a per-file state a person can Retry.
  request.timeout = Math.max(60_000, Math.round((file.size / IMAGE_MAX_BYTES) * 300_000));
  request.addEventListener('timeout', () => settled({ kind: 'failed', status: 0 }));

  request.send(file);

  return {
    promise,
    abort(): void {
      try {
        request.abort();
      } catch {
        settled({ kind: 'failed', status: 0 });
      }
    },
  };
}

/** The key the picture is stored under, or null if the answer does not name one. */
function readAssetKey(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== 'object') return null;
    const assetKey = (parsed as { assetKey?: unknown }).assetKey;
    return typeof assetKey === 'string' && assetKey.length > 0 ? assetKey : null;
  } catch {
    return null;
  }
}

/** What the server says the bytes are. Only ever used for a progress label, never for a decision. */
function readContentType(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    const contentType =
      parsed !== null && typeof parsed === 'object'
        ? (parsed as { contentType?: unknown }).contentType
        : undefined;
    return typeof contentType === 'string' ? contentType : '';
  } catch {
    return '';
  }
}
