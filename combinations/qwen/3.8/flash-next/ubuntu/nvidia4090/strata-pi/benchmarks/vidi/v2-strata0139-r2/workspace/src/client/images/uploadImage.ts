import { IMAGE_ACCEPTED_TYPES } from "../../shared/config";

/**
 * `image.insert` — one file, one POST, with progress.
 *
 * `fetch` cannot report upload progress, so this is an `XMLHttpRequest`: it is
 * the one API in this app that tells us how much of a 10 MB body has left the
 * browser, which is what the placeholder's percentage is made of.
 *
 * The response is not a decision point beyond its status: 201 gives the
 * permanent `assetKey`, everything else (413, 415, 404, 500, a network error, an
 * abort) is `failed`, and the caller turns that into the failed render state.
 */

export type UploadResult = { kind: "ok"; assetKey: string } | { kind: "failed"; status?: number };

export interface UploadHandle {
  promise: Promise<UploadResult>;
  abort(): void;
}

/** The upload route for one board (`assets.api`). */
export function assetUploadUrl(boardId: string): string {
  return `/api/boards/${encodeURIComponent(boardId)}/assets`;
}

/** What the file picker offers: the four accepted types, as an `accept` attribute. */
export const FILE_PICKER_ACCEPT = IMAGE_ACCEPTED_TYPES.join(",");

export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): UploadHandle {
  let xhr: XMLHttpRequest | null = null;

  const promise = new Promise<UploadResult>((resolve) => {
    if (typeof XMLHttpRequest !== "function" || typeof boardId !== "string" || boardId.length === 0) {
      // No transport, or no board to upload to: a failure like any other, so the
      // placeholder renders as a failure instead of hanging in "Uploading…".
      resolve({ kind: "failed" });
      return;
    }

    const request = new XMLHttpRequest();
    xhr = request;

    request.open("POST", assetUploadUrl(boardId), true);
    // The body is the file itself. What the browser declares from the file's own
    // type is irrelevant to the Worker's decision, but an image type is what a
    // file that passes the client's checks has.
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");

    if (request.upload) {
      request.upload.onprogress = (event: ProgressEvent) => {
        if (!event.lengthComputable || event.total <= 0) return;
        onProgress(Math.min(1, Math.max(0, event.loaded / event.total)));
      };
    }

    request.onload = () => {
      if (request.status === 201) {
        const assetKey = assetKeyFrom(request.responseText);
        if (assetKey !== null) {
          resolve({ kind: "ok", assetKey });
          return;
        }
      }
      resolve({ kind: "failed", status: request.status });
    };
    request.onerror = () => resolve({ kind: "failed" });
    request.ontimeout = () => resolve({ kind: "failed" });
    request.onabort = () => resolve({ kind: "failed" });

    request.send(file);
  });

  return {
    promise,
    abort() {
      xhr?.abort();
    },
  };
}

function assetKeyFrom(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as { assetKey?: unknown };
    return typeof parsed.assetKey === "string" && parsed.assetKey.length > 0 ? parsed.assetKey : null;
  } catch {
    return null;
  }
}
