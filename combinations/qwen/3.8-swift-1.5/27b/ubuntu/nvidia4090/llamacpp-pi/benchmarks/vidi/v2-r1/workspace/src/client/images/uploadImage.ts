/**
 * Story 12: image decoding and upload (image.insert).
 *
 * decodeImage: pixel dimensions via createImageBitmap, with an <img>
 * fallback for formats the decoder rejects. Decoding failure = the file is
 * not a usable image (gets the 'type' rejection message).
 *
 * uploadImageAsset: POST to the asset API. The server decides the stored
 * Content-Type from magic bytes; the returned assetKey is the only
 * reference we keep.
 */

export interface DecodedImage {
  width: number;
  height: number;
  blob: Blob;
  contentType: string;
}

export class DecodeError extends Error {}

/** Decode an image file to its natural pixel dimensions. */
export async function decodeImage(file: File): Promise<DecodedImage> {
  try {
    const bitmap = await createImageBitmap(file);
    const width = bitmap.width;
    const height = bitmap.height;
    bitmap.close();
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new DecodeError('bad dimensions');
    }
    return { width, height, blob: file, contentType: file.type };
  } catch (err) {
    if (!(err instanceof DecodeError) && !(err instanceof DOMException)) {
      // Unexpected: fall through to the <img> path.
    }
    // Fallback: load through an <img> element.
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new DecodeError('decode failed'));
        el.src = url;
      });
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      if (!width || !height) throw new DecodeError('decode failed');
      return { width, height, blob: file, contentType: file.type };
    } catch (err2) {
      throw err2 instanceof DecodeError ? err2 : new DecodeError('decode failed');
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

export interface UploadResult {
  assetKey: string;
  contentType: string;
}

/** Upload an image blob to the board's asset API. Throws on non-2xx. */
export async function uploadImageAsset(boardId: string, blob: Blob): Promise<UploadResult> {
  const res = await fetch(`/api/boards/${boardId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!res.ok) {
    throw new Error(`upload failed: HTTP ${res.status}`);
  }
  return (await res.json()) as UploadResult;
}

/**
 * Upload function with progress. XHR gives progress events (fetch does not);
 * falls back to fetch where XHR is unavailable. Resolves with the assetKey.
 */
export type UploadFn = (
  boardId: string,
  blob: Blob,
  onProgress?: (p: number) => void,
) => Promise<string>;

export const uploadImageWithProgress: UploadFn = (boardId, blob, onProgress) => {
  return new Promise<string>((resolve, reject) => {
    if (typeof XMLHttpRequest === 'undefined') {
      uploadImageAsset(boardId, blob).then(
        (r) => resolve(r.assetKey),
        (err) => reject(err),
      );
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/boards/${boardId}/assets`);
    xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress?.(Math.min(1, e.loaded / e.total));
    });
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { assetKey?: string };
          if (body.assetKey) {
            resolve(body.assetKey);
            return;
          }
        } catch {
          // fall through to failure
        }
        reject(new Error('malformed upload response'));
      } else {
        reject(new Error(`upload failed: HTTP ${xhr.status}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('network error')));
    xhr.addEventListener('timeout', () => reject(new Error('upload timeout')));
    xhr.send(blob);
  });
};
