/**
 * Story 12 · the image upload (design "Upload transport").
 *
 * Uploading uses `XMLHttpRequest`, not `fetch`, for one reason: the `progress`
 * event. The placeholder carries a real percentage (PRD image.uploading), and
 * that only exists on XHR. There is no `AbortController` — XHR has `abort()` and
 * we do not need cross-request cancellation here.
 *
 * `File` is a `Blob` in every scope this runs in, so the module never touches
 * the file-system API. It reads nothing but the reference the caller hands it.
 *
 * The outcome is the shared {@link AssetFailure} plus the asset key on success;
 * the caller decides what the failure means for the object (a `failed` status, a
 * toast). A network error and a `5xx`/non-JSON reply both land as `failed` —
 * this module cannot tell an unrelated board problem from a storage outage, and
 * the PRD asks only that a failure be reported.
 */
import type { AssetResult } from '../../shared/assets-protocol';

/** Upload one image. Resolves with the outcome; never rejects on an HTTP error. */
export function uploadImage(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
): Promise<AssetResult> {
  return new Promise<AssetResult>((resolve) => {
    const body = new FormData();
    // `images` matches the Worker's `request.formData().get('images')`.
    body.append('images', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    // A file that is too big or the wrong type is refused by size / magic, never
    // by this header, so nothing here can be spoofed to bypass the checks.
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    xhr.onerror = () => resolve({ ok: false, reason: 'failed', status: 0 });
    xhr.ontimeout = () => resolve({ ok: false, reason: 'failed', status: 0 });
    xhr.onload = () => {
      let parsed: AssetResult | null = null;
      try {
        parsed = JSON.parse(xhr.responseText) as AssetResult;
      } catch {
        parsed = null;
      }
      // The Worker answers a successful upload with `201 Created` (one line per
      // stored key); accept any 2xx that carries an `ok` body, not just 200.
      if (xhr.status >= 200 && xhr.status < 300 && parsed && parsed.ok) {
        resolve({ ok: true, assetKey: parsed.assetKey });
      } else if (xhr.status === 413) {
        resolve({ ok: false, reason: 'too_large', status: 413 });
      } else if (xhr.status === 415) {
        resolve({ ok: false, reason: 'unsupported', status: 415 });
      } else {
        resolve({ ok: false, reason: 'failed', status: xhr.status });
      }
    };
    xhr.send(body);
  });
}