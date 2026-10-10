/**
 * Story 12: one image file, up to the server (`image.uploading`).
 *
 * `fetch` is the way this codebase talks to its API everywhere else (`src/client/api.ts`),
 * and it is still the right call for reading a board. It is not the right call here, because
 * `fetch` has no upload progress: a 6 MB photo taken seriously, on a train, takes long enough
 * for a person to wonder whether anything started, and the PRD asks for a percentage that
 * moves. `XMLHttpRequest.upload.onprogress` is the one browser API that reports it, so this
 * one request is made with the older object, and the promise it hands back is shaped so the
 * rest of the story never has to know that.
 */
import { isAssetKey } from '../../shared/image-format';

/** Where an image is uploaded to, and where it is served from (`src/worker/index.ts`). */
export const ASSETS_UPLOAD_API = '/api/boards';
export const ASSETS_SERVE_API = '/api/assets';

export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

export interface UploadHandle {
  /** Settles once the server has answered, or has failed to. Never rejects. */
  promise: Promise<UploadResult>;
  /** Give up: the response is discarded and the promise settles as `failed`. */
  abort(): void;
}

/** Upload here: one POST per file, so one failed file does not take the batch with it. */
export function uploadUrl(boardId: string): string {
  return `${ASSETS_UPLOAD_API}/${encodeURIComponent(boardId)}/assets`;
}

/**
 * The address the finished image is served from, or null when `assetKey` is not a key at all.
 *
 * The two halves are encoded separately rather than the whole key: a key that contained a `/`
 * would be a path that escapes this route, and a URL that has to be escaped is a URL that
 * would not be served from (see the worker's key pattern).
 */
export function assetUrl(assetKey: string): string | null {
  if (!isAssetKey(assetKey)) return null;
  const [boardId, assetId] = assetKey.split('/');
  return `${ASSETS_SERVE_API}/${encodeURIComponent(boardId)}/${encodeURIComponent(assetId)}`;
}

interface UploadBody {
  assetKey?: unknown;
}

/**
 * The key from a 201 answer, or null when the body did not carry one. A 201 that does not say
 * where the image is cannot be used — the bytes are stored and nobody can point at them — so
 * it is treated as the failure it is, rather than as a ready image with no address.
 */
function assetKeyFrom(body: string): string | null {
  if (typeof body !== 'string' || body.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const key = (parsed as UploadBody).assetKey;
  return typeof key === 'string' && key.length > 0 ? key : null;
}

/**
 * Upload `file` as an asset of `boardId`, reporting how far it has got as a fraction in
 * `[0, 1]`.
 *
 * The returned object settles when the upload is over and never rejects: a failed upload is a
 * thing that happened to one image, not a reason to stop the other nineteen. `status` is the
 * HTTP code when the server answered — the reason a person is told "Upload failed" rather
 * than having to guess whether it was the network or the file.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const request = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve) => {
    request.upload.addEventListener('progress', (event) => {
      // `lengthComputable` is false when the browser had to encode the body itself; there is
      // no total to divide by, and a made-up percentage is worse than one that does not move.
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(1, event.loaded / event.total));
    });
    request.addEventListener('load', () => {
      if (request.status === 201) {
        const assetKey = assetKeyFrom(request.responseText);
        if (assetKey !== null) {
          // Progress is reported as finished by the answer rather than by the last progress
          // event, which can stop short of the total while the server is still reading.
          onProgress(1);
          resolve({ kind: 'ok', assetKey });
          return;
        }
      }
      resolve({ kind: 'failed', status: request.status });
    });
    // A network failure and an abort both mean "no answer", and the board shows the same box
    // for both; the difference is only visible in the console.
    request.addEventListener('error', () => resolve({ kind: 'failed' }));
    request.addEventListener('timeout', () => resolve({ kind: 'failed' }));
    request.addEventListener('abort', () => resolve({ kind: 'failed' }));
    request.open('POST', uploadUrl(boardId));
    // The server ignores this and trusts the bytes (story 12 security), but a request that
    // says what it contains is a request somebody can debug from the network tab.
    request.setRequestHeader('Content-Type', file.type);
    request.send(file);
  });
  return {
    promise,
    abort() {
      request.abort();
    },
  };
}
