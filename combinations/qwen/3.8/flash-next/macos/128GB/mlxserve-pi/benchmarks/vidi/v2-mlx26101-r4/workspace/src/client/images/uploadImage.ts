/**
 * Getting one file onto the server, and knowing how far along it is (story 12).
 *
 * This is `XMLHttpRequest`, and it is the whole reason this file exists rather than being four lines of
 * `fetch`. `fetch` reports the *end* of a request; it never says how much of the body has been sent. A 9 MB photo
 * on a bad connection takes tens of seconds, and the board's promise during that time is a placeholder with a
 * percentage in it — a number only the browser's upload progress events have. Every other request on this board
 * is a `fetch`, and this one is different for a reason that outlives the story.
 *
 * The other thing this file decides is what a failure is. Everything that goes wrong — a 413, a 415, a network
 * that died, a board that was deleted while the bytes were in the air — comes back as `{ kind: 'failed', status }`
 * and never as a rejected promise. A caller that has to wrap every upload in a `catch` is a caller that will
 * eventually forget one, and an unhandled rejection in a browser tab is a failure nobody sees. The status is
 * carried along because it is the difference between "the server said no" and "nothing answered", which is worth
 * having in a log line at half past nine when somebody's pictures are not appearing.
 */

/** Where a picture is once it is stored. */
export interface UploadOk {
  readonly kind: 'ok';
  /** `<board id>/<asset id>`, exactly as it is written in the bucket. */
  readonly assetKey: string;
  /** The type the server read out of the bytes — which is the type it will hand back. */
  readonly contentType: string;
}

/** The upload did not end with a stored picture. */
export interface UploadFailed {
  readonly kind: 'failed';
  /** The HTTP status, when there was an answer to have one from. Absent means nothing answered. */
  readonly status?: number;
}

export type UploadResult = UploadOk | UploadFailed;

/** What the upload is doing, and the one way to stop it. */
export interface UploadHandle {
  readonly promise: Promise<UploadResult>;
  /** Give up. The promise settles as `failed`; nothing is written to the board afterwards. */
  abort(): void;
}

/** Where a picture is posted to. The route sniffs the bytes and ignores the type the browser claims. */
export function assetUploadUrl(boardId: string): string {
  return `/api/boards/${encodeURIComponent(boardId)}/assets`;
}

/**
 * Upload one file to one board.
 *
 * The caller is handed a promise and an `abort` in the same object, because the abort has to be reachable from
 * whatever asked for the upload — a person who deletes the placeholder while its bytes are on their way means
 * it, and the upload should stop rather than carry on for thirty seconds and then report a result nobody asked
 * for.
 *
 * Nothing here touches the document. What a result *means* — a key written into the image, or a failed state
 * shown to everybody — is the caller's business, and keeping the two apart is what lets this be called against a
 * server that is not there.
 */
export function uploadImage(
  boardId: string,
  file: File | Blob,
  onProgress: (fraction: number) => void = (): void => {},
): UploadHandle {
  const request = new XMLHttpRequest();
  let settle: ((result: UploadResult) => void) | null = null;

  const finish = (result: UploadResult): void => {
    const done = settle;
    settle = null;
    done?.(result);
  };

  const promise = new Promise<UploadResult>((resolve) => {
    settle = resolve;

    request.open('POST', assetUploadUrl(boardId), true);
    // What the browser thinks the file is. The server reads the bytes and ignores this; it is sent because a
    // request that says nothing about its body is harder to read in a network log than one that says what the
    // person meant.
    if (typeof file.type === 'string' && file.type !== '') request.setRequestHeader('Content-Type', file.type);

    request.upload.addEventListener('progress', (event) => {
      // `lengthComputable` is false when the browser cannot work out the size — and a percentage that is a guess
      // is worse than a bar that has stopped moving.
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(1, event.loaded / event.total));
    });

    request.addEventListener('load', () => {
      finish(readOutcome(request.status, request.responseText));
    });
    // Three ways an upload does not happen, and all three are the same news to the board: nothing was stored.
    request.addEventListener('error', () => finish({ kind: 'failed' }));
    request.addEventListener('abort', () => finish({ kind: 'failed' }));
    request.addEventListener('timeout', () => finish({ kind: 'failed' }));

    request.send(file as Blob);
  });

  return {
    promise,
    abort(): void {
      // `finish` has already run once the request answered, and an abort after that is telling a
      // `XMLHttpRequest` about a request that is over.
      if (settle !== null) request.abort();
    },
  };
}

/**
 * What a response means.
 *
 * A 201 whose body does not read is a failure and not a success with a field missing: an image whose key could
 * not be read cannot be drawn, cannot be shared with anybody and cannot be retried, because there would be
 * nothing to point at.
 */
export function readOutcome(status: number, body: string): UploadResult {
  if (status === 201) {
    try {
      const parsed = JSON.parse(body) as { assetKey?: unknown; contentType?: unknown };
      if (typeof parsed.assetKey === 'string' && parsed.assetKey.length > 0) {
        return {
          kind: 'ok',
          assetKey: parsed.assetKey,
          contentType: typeof parsed.contentType === 'string' ? parsed.contentType : '',
        };
      }
    } catch {
      // A 201 that is not the JSON we agreed on is an answer this board cannot use.
    }
  }
  return { kind: 'failed', status };
}
