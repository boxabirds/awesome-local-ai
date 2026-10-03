/**
 * One picture's way into the bucket (`image.uploading`).
 *
 * `XMLHttpRequest` and not `fetch`, for one reason: `fetch` has no upload progress. The PRD
 * asks the uploader to see a percentage while their own upload runs (`image.uploading`), and
 * the only place a browser reports the bytes it has *sent* is an XHR `upload.onprogress`
 * event. Everything else about it — the response mapping, the failure that has no status —
 * is the shape the caller has to handle whatever transport it is given.
 *
 * The body is the raw `File`. Nothing is wrapped in `FormData` and no `Content-Type` is set
 * by hand: the Worker decides what the file is from its first bytes and ignores the header
 * entirely (`assets.api`), so a multipart envelope and a boundary would only have to be
 * unwrapped before being ignored.
 *
 * A failure is a value, never a throw. Every path out of this function is a `UploadResult`,
 * including the ones the network refuses to explain, because the caller's job is to mark one
 * placeholder failed and to keep the `File` for a Retry — and it can only do that if it is
 * called.
 */
/**
 * What a stored asset's `201` carries: the key it landed under, and the type the bytes were
 * read as. Duplicated rather than imported from `worker/assets.ts`, because the client's
 * program must not reach into the Worker's — the two agree on this shape because
 * `tests/integration/assets.test.ts` reads the same fields out of a real response.
 */
interface StoredAssetBody {
  assetKey: string;
  contentType: string;
}

export type UploadResult = { kind: 'ok'; assetKey: string } | { kind: 'failed'; status?: number };

/** An upload in flight, and the only two things its owner can still do with it. */
export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/** Where a board's pictures are stored. Relative, because the client and the API share one origin. */
export function assetUploadUrl(boardId: string): string {
  return `/api/boards/${encodeURIComponent(boardId)}/assets`;
}

/** The body says 201 and carries a key. Anything else is a failure, however well-formed. */
function assetKeyFrom(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as Partial<StoredAssetBody>;
    return typeof parsed.assetKey === 'string' && parsed.assetKey.length > 0 ? parsed.assetKey : null;
  } catch {
    return null;
  }
}

/**
 * Send `file` to the board's asset route, reporting the fraction sent as it goes.
 *
 * `onProgress` receives 0 → 1. It is called with 1 the moment the server has answered, so a
 * caller that shows a percentage never leaves a bar at 99% while it waits on the response.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const request = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve) => {
    request.upload.addEventListener('progress', (event) => {
      const total = event.lengthComputable ? event.total : file.size;
      onProgress(total > 0 ? Math.min(1, event.loaded / total) : 0);
    });

    request.addEventListener('load', () => {
      if (request.status === 201) {
        const assetKey = assetKeyFrom(request.responseText);
        if (assetKey !== null) {
          resolve({ kind: 'ok', assetKey });
          return;
        }
      }
      // 413, 415, 404, 500 and anything else that answered: all the same thing to the
      // person looking at the placeholder, which is a picture that did not arrive. The
      // status is carried along for the log, not for the message.
      resolve({ kind: 'failed', status: request.status });
    });

    const failed = () => {
      // No status: the request never got an answer. A dropped connection, a board that went
      // away mid-upload, a browser that gave up.
      resolve({ kind: 'failed' });
    };
    request.addEventListener('error', failed);
    request.addEventListener('timeout', failed);
    request.addEventListener('abort', failed);

    request.open('POST', assetUploadUrl(boardId));
    request.responseType = 'text';
    request.send(file);
  });

  return {
    promise,
    abort() {
      request.abort();
    },
  };
}
