/*! One file, up to the board's store, with progress (story 12).
 *
 * `fetch` cannot report how much of a body it has sent; `XMLHttpRequest` can, and
 * that is the whole reason this file uses the older API. The other reason is what
 * it does *not* do: it does not wait for the whole response before it says anything
 * about the bytes it has already given up.
 *
 * The progress it reports is the browser's own count of bytes sent, which is a fact
 * about the network rather than about the image: it reaches 1 long before the board
 * has stored anything, because the last part of an upload is the wait for the answer.
 * The bar is honest about that — it is a bar about bytes, and the state that says
 * whether the image exists is the object's status, not this number.
 */
import { boardAssetsPath } from '../../shared/routes';

/** What came back from one attempt. */
export type UploadResult =
  | { kind: 'ok'; assetKey: string; contentType: string }
  /** `status` is the HTTP status, or absent when the request never got an answer
   *  at all — which is what "you are offline" looks like from here. */
  | { kind: 'failed'; status?: number };

/** What one upload is: something that can be waited for, and stopped. */
export interface ImageUpload {
  promise: Promise<UploadResult>;
  /** Give up on this attempt. The object's status is somebody else's business —
   *  the caller decides whether a cancelled upload is a failure or a retry. */
  abort(): void;
}

/** Ask for a fraction between 0 and 1, and get one. */
function fraction(sent: number, total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0;
  const value = sent / total;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * Send `file`'s bytes to board `boardId` and report how much of it got there.
 *
 * `onProgress` is called with a fraction of the file as the bytes leave, which is
 * what the placeholder's bar is drawn from. It is never called with a number the
 * bar cannot draw: a total of zero (an upload whose size the browser will not say)
 * gives 0, and the fraction is clamped at 1.
 *
 * Nothing here throws. A request that could not be made, a network that fell over
 * mid-send, a board that answered 413 or 415 or 500 and a board that answered
 * something which was not the JSON it promises all come back as
 * `{ kind: 'failed' }`, because a failed upload is a thing that happened rather
 * than a thing that went wrong here (TC-20).
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): ImageUpload {
  const request = new XMLHttpRequest();
  let settled = false;

  const promise = new Promise<UploadResult>((resolve) => {
    const settle = (result: UploadResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    request.upload.onprogress = (event: ProgressEvent) => {
      if (onProgress === undefined) return;
      onProgress(fraction(event.loaded, event.total));
    };

    request.onload = () => {
      if (request.status < 200 || request.status >= 300) {
        settle({ kind: 'failed', status: request.status });
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(request.responseText);
      } catch {
        // A 200 from something which is not the board — a proxy, a captive
        // network — is not an asset key, however encouraging the status looks.
        settle({ kind: 'failed', status: request.status });
        return;
      }
      const key =
        typeof body === 'object' && body !== null
          ? (body as { assetKey?: unknown }).assetKey
          : undefined;
      const contentType =
        typeof body === 'object' && body !== null
          ? (body as { contentType?: unknown }).contentType
          : undefined;
      if (typeof key !== 'string' || key === '') {
        settle({ kind: 'failed', status: request.status });
        return;
      }
      // The bar reaches the end when the answer arrives, not before: the bytes
      // having left is not the same as the picture being on the board.
      onProgress?.(1);
      settle({
        kind: 'ok',
        assetKey: key,
        contentType: typeof contentType === 'string' ? contentType : file.type,
      });
    };

    request.onerror = () => {
      settle({ kind: 'failed' });
    };
    request.ontimeout = () => {
      settle({ kind: 'failed' });
    };
    request.onabort = () => {
      settle({ kind: 'failed' });
    };

    // The file goes as the body, whole: a File is a Blob, and the Worker reads the
    // bytes and decides what they are. Nothing about the file's *name* is sent,
    // because the name is not information about the board.
    request.open('POST', boardAssetsPath(boardId));
    request.send(file);
  });

  return {
    promise,
    abort() {
      if (settled) return;
      try {
        request.abort();
      } catch {
        // Already finished; the promise has the answer either way.
      }
    },
  };
}
