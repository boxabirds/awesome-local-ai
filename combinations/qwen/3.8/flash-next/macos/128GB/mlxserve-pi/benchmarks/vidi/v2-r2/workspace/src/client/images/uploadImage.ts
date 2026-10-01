// One picture's journey from the computer to the board's bucket (story 12).
//
// `fetch` is the client's HTTP call everywhere else in this app, and it is wrong here for one
// reason only: it reports nothing while the body is going out. A person who has just dropped a
// nine-megabyte photograph onto a slow link has earned a number that climbs, and
// `XMLHttpRequest`'s `upload` progress events are the one browser API that gives it. Everything
// else about this module is deliberately dull: send the bytes, read the key back, turn whatever
// happened into one of two answers.
//
// The answers are a union rather than a thrown error for the same reason the rest of the client
// API is one: an upload that failed is an ordinary event on a board, not an exception. The
// caller marks the placeholder failed and shows Retry; nothing has to be caught anywhere above.

/** Where the picture ended up: the key it is stored under, or the answer that came back. */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  /**
   * `status` is the HTTP answer when there was one (413, 415, 404, 500, ...) and absent when
   * there was none at all - the link dropped, the browser refused the request, the tab was
   * closed mid-upload. The caller treats both the same way today; the distinction is kept
   * because a log that says "no response" and one that says "413" are different facts.
   */
  | { kind: 'failed'; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  /**
   * Give up on this upload. The placeholder is left as it is - still `uploading` - which is
   * what an abandoned upload looks like to everyone else, and what `displayStatus` turns into
   * `unfinished` five minutes later. Resolving the promise as `failed` is what the caller who
   * asked for the abort is told, so it never marks a picture it stopped as ready.
   */
  abort(): void;
}

/** `POST /api/boards/:id/assets` - the same relative address `src/client/api.ts` uses. */
function uploadUrl(boardId: string): string {
  return `/api/boards/${encodeURIComponent(boardId)}/assets`;
}

/**
 * The key out of an upload response.
 *
 * A 201 whose body does not name a picture is not a picture: the alternative is a placeholder
 * marked ready with nothing to show, which is a broken image the person who added it can never
 * fix. So the answer is read the way `api.ts` reads a created board's id - defensively, and as
 * a failure when the shape is not there.
 */
function assetKeyOf(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const key = (parsed as { assetKey?: unknown }).assetKey;
  return typeof key === 'string' && key !== '' ? key : null;
}

/**
 * Send one file to the board's bucket, reporting how much of it has left.
 *
 * Never rejects. The `Content-Type` header is deliberately not sent: the Worker judges a
 * picture by its bytes, and a browser that volunteered `image/png` for a file that is a PDF
 * wearing a name would only be adding to the confusion.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const request = new XMLHttpRequest();
  let settled = false;
  let settle!: (result: UploadResult) => void;
  const promise = new Promise<UploadResult>((resolve) => {
    settle = resolve;
  });

  /** The first answer wins: `load` and then `error` (or an abort in between) cannot both speak. */
  const finish = (result: UploadResult): void => {
    if (settled) return;
    settled = true;
    settle(result);
  };

  request.upload.addEventListener('progress', (event) => {
    // `total` is the declared length, which a browser sometimes does not know; the file's own
    // size is the better answer when it does not, and a upload of nothing at all reports
    // nothing. The fraction is clamped because a body that grows past its declared length
    // would otherwise show 137%.
    const total = event.total > 0 ? event.total : file.size;
    if (total <= 0) return;
    onProgress(Math.max(0, Math.min(1, event.loaded / total)));
  });

  request.addEventListener('load', () => {
    if (request.status < 200 || request.status >= 300) {
      finish({ kind: 'failed', status: request.status });
      return;
    }
    const assetKey = assetKeyOf(request.responseText);
    finish(assetKey === null ? { kind: 'failed', status: request.status } : { kind: 'ok', assetKey });
  });
  // Nothing arrived, or nothing was going to: a network failure and a cancelled request look
  // the same from here, and the answer is the same - this picture has no bytes.
  request.addEventListener('error', () => finish({ kind: 'failed' }));
  request.addEventListener('timeout', () => finish({ kind: 'failed' }));
  request.addEventListener('abort', () => finish({ kind: 'failed' }));

  request.open('POST', uploadUrl(boardId), true);
  request.send(file);

  return {
    promise,
    abort: () => {
      if (request.readyState === XMLHttpRequest.DONE) return;
      request.abort();
    },
  };
}
