/**
 * One image, uploaded, with the progress the placeholder shows (PRD image.uploading).
 *
 * `fetch` is not used because it cannot report upload progress at all — the number in
 * the placeholder comes from `XMLHttpRequestUpload.onprogress`, and only XHR has that.
 * The body is the `File` itself, sent raw: the server decides what the file is from
 * its first bytes and ignores `Content-Type` entirely (PRD image.types).
 *
 * Like the rest of the client API (`src/client/api.ts`) this never throws: a network
 * failure, a 413 and an aborted request are all results, because what happens next is
 * a state on the board ("Upload failed", Retry), not an exception in a component.
 */

/** Where the upload got to. A `failed` result carries a status only if there was one. */
export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

export interface UploadHandle {
  /** Settles once, whatever happens. Aborting settles it as `failed` with no status. */
  readonly promise: Promise<UploadResult>;
  /** Give up on this upload. Safe to call more than once, and after it settled. */
  abort(): void;
}

/** `POST /api/boards/:boardId/assets` (see `src/worker/assets.ts`). */
export function assetsEndpoint(boardId: string): string {
  return `/api/boards/${encodeURIComponent(boardId)}/assets`;
}

/** The key a 201 promised, or null for a body that does not carry one. */
function assetKeyOf(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { assetKey?: unknown };
    return typeof parsed.assetKey === 'string' && parsed.assetKey.length > 0 ? parsed.assetKey : null;
  } catch {
    return null;
  }
}

/**
 * Where a browser asks for a stored image. Each segment is escaped, because an
 * `assetKey` is `<boardId>/<assetId>` and this is the only place a key from the document
 * becomes a URL (the key itself was checked when it was written, see
 * `isAssetKey` in `src/shared/image-format.ts`).
 */
export function assetUrl(assetKey: string): string {
  const segments = assetKey.split('/').map((part) => encodeURIComponent(part));
  return `/api/assets/${segments.join('/')}`;
}

/**
 * Upload `file` for `boardId`, reporting the fraction uploaded (0 to 1) as it goes.
 *
 * @sideeffect one POST per call; `abort()` closes it.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const request = new XMLHttpRequest();
  request.open('POST', assetsEndpoint(boardId));

  // `upload.onprogress` is the upload's own progress: it finishes long before the
  // server has answered (it still has to sniff the bytes and write them to the bucket),
  // which is why the fraction stops at 1 while the placeholder still says "uploading".
  request.upload.onprogress = (event: ProgressEvent) => {
    if (event.lengthComputable) onProgress(Math.min(1, Math.max(0, event.loaded / event.total)));
  };

  const promise = new Promise<UploadResult>((resolve) => {
    request.onload = () => {
      if (request.status === 201) {
        const assetKey = assetKeyOf(request.responseText);
        // A 201 that does not name a key is a failure: without it there is nothing to
        // point an <img> at, and pretending otherwise would show a broken image.
        resolve(assetKey ? { kind: 'ok', assetKey } : { kind: 'failed', status: request.status });
        return;
      }
      resolve({ kind: 'failed', status: request.status });
    };
    // No status means the request never got an answer: offline, a refused connection,
    // or an abort. The caller distinguishes its own abort, so this stays simple.
    request.onerror = () => resolve({ kind: 'failed' });
    request.ontimeout = () => resolve({ kind: 'failed' });
    request.onabort = () => resolve({ kind: 'failed' });
  });

  request.send(file);

  return {
    promise,
    abort: () => {
      if (request.readyState > 0 && request.readyState < 4) request.abort();
    },
  };
}
