/**
 * The one network request an added image makes: the file's bytes, posted to the board's asset address,
 * with the progress of that post.
 *
 * `fetch` is the modern way to send a request, and it is not used here for one reason: it reports nothing
 * while the request is being *sent*. The PRD asks for the uploader to see progress while a ten-megabyte
 * photograph is going up, and an upload's progress is exactly the half of a request `fetch` keeps to
 * itself. `XMLHttpRequest` exposes it - `upload.onprogress`, one event per chunk the browser has handed
 * to the network - which is why the choice is made here and not somewhere else. It also gives the other
 * half of what the failure path needs: an upload that never finished can be called off.
 *
 * Nothing about the *decision* to upload lives here. That is {@link useImageInsert}'s; this function is
 * given a file and a place to put its bytes, and does not ask what is on the board.
 */
import { isValidBoardId } from '../../shared/board-id';
import { ASSET_KEY_PATTERN } from '../../shared/image-format';

/**
 * How one image upload ended.
 *
 * `ok` carries the asset key the server handed back - which is the only place the key comes from, which
 * is why a response this cannot read is a failure rather than a shrug. The reasons are for logs and tests;
 * the person sees one message for all of them.
 */
export type UploadResult =
  | { ok: true; assetKey: string }
  | {
      ok: false;
      reason: 'network' | 'timeout' | 'aborted' | 'rejected_by_server' | 'no_response' | 'bad_response' | 'bad_board_id';
      /** HTTP status, or 0 for a request that never got one. */
      status: number;
    };

/**
 * The address a board's bytes are posted to, or `null` for an id that cannot name a board.
 *
 * The id is checked here rather than left to the server's 404 because this is where it goes into a URL: an
 * id containing a slash would put the request somewhere else entirely, and a client that builds addresses
 * out of unchecked strings is how a board ends up posting to somebody else's path.
 */
export function assetUploadUrl(boardId: string): string | null {
  return isValidBoardId(boardId) ? `/api/boards/${boardId}/assets` : null;
}

export interface ImageUpload {
  /**
   * Settles once, whatever happens. It never rejects: an upload that failed is an outcome rather than an
   * exception, because the caller's job is to mark one object as failed, not to have a rejection to catch
   * floating around an `await` it forgot to guard.
   */
  promise: Promise<UploadResult>;
  /**
   * Call the upload off. Used when the tab goes away, and otherwise nothing: an upload in flight is not
   * harmful, but a callback into a document that has been thrown away is, and there is no reason to keep
   * sending bytes nobody is waiting for.
   */
  abort(): void;
}

/**
 * Post `file` to its board's asset collection.
 *
 * The body is the file itself, and the `Content-Type` that goes with it is the file's *claimed* type -
 * which the worker ignores, by design: the decision is made from the bytes. It is sent anyway because a
 * server that ignores a header is a different thing from a client that sends nothing, and because a
 * component test that wants to know what was sent can read it off the request.
 *
 * @param boardId which board owns the bytes; an id that does not fit the pattern is refused here rather
 * than at the server, because the address is built out of it.
 * @param file the bytes to send.
 * @param onProgress called with the fraction of the file the browser has handed over, `0` to `1`. It is
 * called as often as the browser likes, and the caller should expect more calls than it needs.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): ImageUpload {
  const request = new XMLHttpRequest();
  const url = assetUploadUrl(boardId);

  const promise = new Promise<UploadResult>((resolve) => {
    if (url === null) {
      resolve({ ok: false, reason: 'bad_board_id', status: 0 });
      return;
    }
    request.upload.addEventListener('progress', (event: ProgressEvent) => {
      if (onProgress === undefined || !event.lengthComputable || event.total <= 0) {
        return;
      }
      // Never more than 1, whatever the browser reports: the caller turns this into a bar, and a bar that
      // is 104% full is a bar that is lying about being finished.
      onProgress(Math.min(1, event.loaded / event.total));
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        const key = assetKeyFromResponse(request.responseText, boardId);
        if (key === null) {
          // A 201 whose body this cannot read. The bytes may well have been stored, but an address nobody
          // can tell is an address nobody can use, and the honest reading is that the upload failed.
          resolve({ ok: false, reason: 'bad_response', status: request.status });
          return;
        }
        resolve({ ok: true, assetKey: key });
        return;
      }
      resolve({ ok: false, reason: reasonForStatus(request.status), status: request.status });
    });
    request.addEventListener('error', () => {
      resolve({ ok: false, reason: 'network', status: 0 });
    });
    request.addEventListener('timeout', () => {
      resolve({ ok: false, reason: 'timeout', status: 0 });
    });
    request.addEventListener('abort', () => {
      resolve({ ok: false, reason: 'aborted', status: 0 });
    });

    request.open('POST', url);
    if (file.type !== '') {
      request.setRequestHeader('Content-Type', file.type);
    }
    request.send(file);
  });

  return {
    promise,
    abort() {
      request.abort();
    },
  };
}

/**
 * The asset id out of an upload response, or `null`.
 *
 * The response is read by hand rather than with `JSON.parse` and a `try`, because the shape is asserted
 * rather than hoped for: a body that is not an object, or whose `assetId` is not a string of a shape an
 * asset key can contain, is a server that does not mean what it says, and `null` is the answer that makes
 * the object go to `failed` instead of producing an `<img>` pointed at nonsense.
 */
export function assetKeyFromResponse(body: string, boardId: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const assetKey = (parsed as { assetKey?: unknown }).assetKey;
  if (typeof assetKey !== 'string' || !ASSET_KEY_PATTERN.test(assetKey)) {
    return null;
  }
  // The key comes back whole, and the whole of it matters: a picture stored under another board's key is
  // bytes nobody on this board will ever be able to ask for, and the service would serve them to them
  // anyway. So the half that says which board it belongs to is checked rather than trusted - the one place
  // in this story where a server's answer could be about a different board than the one being uploaded to.
  if (assetKey.slice(0, assetKey.indexOf('/')) !== boardId) {
    return null;
  }
  return assetKey;
}

/**
 * What a rejected response means, in the two words the caller cares about: was this refused, or did it
 * simply not arrive. The distinction only matters for the log and the tests - the person sees the same
 * `Upload failed` and the same Retry either way - but it is the distinction that tells a file that will
 * never be accepted from a network that will recover, which is what Retry is for.
 */
function reasonForStatus(status: number): 'rejected_by_server' | 'no_response' {
  // 413 too_large and 415 unsupported_type are refusals: the same file will be refused again.
  // Anything else - a 500, a 404 for a board that has not been created yet, a proxy that answered 502 -
  // is a request that did not get through to something that could decide.
  return status === 413 || status === 415 ? 'rejected_by_server' : 'no_response';
}
