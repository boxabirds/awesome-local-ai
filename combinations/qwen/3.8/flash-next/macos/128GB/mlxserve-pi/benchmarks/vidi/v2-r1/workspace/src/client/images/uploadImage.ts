// Sending one image file to the server, and how far it has got (`image.uploading`).
//
// This is the one place in story 12 that reaches for `XMLHttpRequest` rather than
// `fetch`, and it does so for a single reason carried all the way from the design:
// `fetch` reports nothing while an upload is *going up* — you learn the answer, never
// the progress — and the product promise (`image.uploading`) is a percentage the
// uploader watches climb while the bytes are still leaving the machine. `xhr.upload`
// has a `progress` event; `fetch` has nothing to put in its place.
//
// Everything the server can answer is mapped to a plain `UploadResult` here rather
// than thrown: a 201 with a key is `ok`, and a 413 / 415 / 404 / 500 — or a network
// error, or an abort — is `failed`, with the status when there is one. The caller in
// `useImageInsert` turns `failed` into `markImageFailed`; nothing here needs to know
// why, because the image's failed state does not explain itself to anyone but the
// uploader, and even then as Retry rather than as a code.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Adding images"
// (image.insert).

/** What an upload ended as: the stored key, or a failure with a status if there was one. */
export type UploadResult =
  | { kind: 'ok'; assetKey: string }
  | { kind: 'failed'; status?: number };

/** The endpoint one image is posted to; the raw body is the file itself. */
const uploadUrl = (boardId: string): string => `/api/boards/${encodeURIComponent(boardId)}/assets`;

/**
 * Upload `file` for `boardId`, reporting the fraction sent (0–1) as it goes, and hand
 * back both the eventual result and a way to stop. The abort is what lets a board
 * that a person has left mid-upload stop asking rather than finish into a document
 * nobody is looking at.
 */
export function uploadImage(
  boardId: string,
  file: File,
  onProgress: (fraction: number) => void,
): { promise: Promise<UploadResult>; abort(): void } {
  const request = new XMLHttpRequest();
  request.open('POST', uploadUrl(boardId), true);

  const promise = new Promise<UploadResult>((resolve) => {
    request.upload.addEventListener('progress', (event) => {
      const total = event.lengthComputable ? event.total : file.size;
      if (total > 0) onProgress(Math.min(1, event.loaded / total));
    });
    request.addEventListener('load', () => {
      if (request.status === 201) {
        try {
          const body = JSON.parse(request.responseText) as { assetKey?: unknown };
          if (typeof body.assetKey === 'string') {
            resolve({ kind: 'ok', assetKey: body.assetKey });
            return;
          }
        } catch {
          // A 201 we cannot read is no better than a failure to store.
        }
        resolve({ kind: 'failed', status: request.status });
        return;
      }
      // 413 / 415 / 404 / 500 and anything else the server answered: failed, with the
      // status only so the caller could tell them apart if it ever wanted to.
      resolve({ kind: 'failed', status: request.status });
    });
    request.addEventListener('error', () => resolve({ kind: 'failed' }));
    request.addEventListener('timeout', () => resolve({ kind: 'failed' }));
    // An abort is `uploadImage`'s own doing, and lands as a failure so nothing waits.
    request.addEventListener('abort', () => resolve({ kind: 'failed' }));

    // The raw bytes go up as the body. No `Content-Type` is set on purpose: the server
    // decides the type from the bytes and ignores any header (assets.api).
    request.send(file);
  });

  return {
    promise,
    abort(): void {
      request.abort();
    },
  };
}
