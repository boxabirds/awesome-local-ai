/**
 * Sending one image's bytes to the board (story 12).
 *
 * `fetch` is not used here because it cannot report upload progress: a person watching a 9 MB photo
 * cross a hotel wifi is the exact case the percentage on the placeholder exists for. `XMLHttpRequest`
 * is the one API in the browser that says how many bytes of the *request* have left, which is what
 * `upload.onprogress` is.
 *
 * The result is deliberately small. `ok` carries the address the server chose; `failed` carries the
 * status when there was one. Everything a person is told about a failed upload comes from the
 * placeholder's state, not from this file, so nothing here tries to describe a failure - it only
 * says that there was one, and how the server said so.
 */
/** What an upload ended as. */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

/** An upload you can watch and can stop. */
export interface UploadHandle {
  readonly promise: Promise<UploadResult>;
  /**
   * Gives up on the transfer. The promise settles as `failed`, because from here there is no
   * difference between "it went wrong" and "you stopped it": the bytes are not on the board.
   */
  abort(): void;
}

/** The address one image is stored at, for one board. */
export function assetUploadUrl(boardId: string): string {
  return `/api/boards/${encodeURIComponent(boardId)}/assets`;
}

/**
 * Where a stored image is read back from.
 *
 * Both halves of the key are already URL-safe, and they are sent through `encodeURIComponent` so that
 * the one thing that separates them - the slash - is the only thing the browser sees as a separator.
 */
export function assetServeUrl(assetKey: string): string {
  return `/api/assets/${assetKey.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * Uploads `file` as the body of a POST.
 *
 * No `Content-Type` is sent from the file: the Worker decides what the bytes are and ignores what we
 * claim, so claiming anything would only make the request look more trustworthy than it is.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  const request = new XMLHttpRequest();
  const promise = new Promise<UploadResult>((resolve) => {
    request.open('POST', assetUploadUrl(boardId), true);
    request.responseType = 'text';

    request.upload.onprogress = (event: ProgressEvent) => {
      // `total` is 0 when the browser cannot know the size; a progress bar with nothing to measure
      // is better left at what it last said than jumped to zero.
      if (!event.total) return;
      const fraction = event.loaded / event.total;
      onProgress(fraction < 0 ? 0 : fraction > 1 ? 1 : fraction);
    };

    request.onload = () => {
      if (request.status === 201) {
        const assetKey = readAssetKey(request.responseText);
        if (assetKey !== null) {
          resolve({ kind: 'ok', assetKey });
          return;
        }
      }
      resolve({ kind: 'failed', status: request.status });
    };

    // An aborted or unreachable upload has no status worth reporting.
    request.onerror = () => resolve({ kind: 'failed' });
    request.ontimeout = () => resolve({ kind: 'failed' });
    request.onabort = () => resolve({ kind: 'failed' });

    request.send(file);
  });

  return {
    promise,
    abort() {
      // `abort()` on a request that already finished is allowed and does nothing.
      request.abort();
    },
  };
}

/** The address from a `201 {"assetKey": …}` body, or null when the body is not one. */
function readAssetKey(body: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as { assetKey?: unknown }).assetKey === 'string' &&
      (parsed as { assetKey: string }).assetKey.length > 0
    ) {
      return (parsed as { assetKey: string }).assetKey;
    }
  } catch {
    // a 201 that did not answer in the expected shape is a failed upload, not a crash
  }
  return null;
}
