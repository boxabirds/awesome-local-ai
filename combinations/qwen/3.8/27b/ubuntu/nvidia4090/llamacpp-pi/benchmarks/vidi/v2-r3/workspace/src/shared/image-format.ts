/**
 * Image format helpers shared by the worker (R2 upload/serve) and the client.
 * Story 12.
 *
 * The worker sniffs real image magic bytes from the first IMAGE_SNIFF_BYTES of
 * the body — the client Content-Type header is never trusted (a PDF renamed to
 * .png must be rejected even when its header says image/png).
 */
import { IMAGE_SNIFF_BYTES, type AcceptedImageType } from './config';

/**
 * Sniff the image type from the leading bytes of a body, or null when the head
 * matches no accepted format. Only the first IMAGE_SNIFF_BYTES are read.
 *
 * - PNG:  89 50 4E 47
 * - JPEG: FF D8 FF
 * - GIF:  GIF87a / GIF89a
 * - WebP: RIFF <4-byte size> WEBP
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const h = head.subarray(0, Math.min(head.length, IMAGE_SNIFF_BYTES));
  if (
    h.length >= 4 &&
    h[0] === 0x89 &&
    h[1] === 0x50 &&
    h[2] === 0x4e &&
    h[3] === 0x47
  ) {
    return 'image/png';
  }
  if (h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    h.length >= 6 &&
    h[0] === 0x47 && // G
    h[1] === 0x49 && // I
    h[2] === 0x46 && // F
    h[3] === 0x38 && // 8
    (h[4] === 0x37 || h[4] === 0x39) && // 7 or 9
    h[5] === 0x61 // a
  ) {
    return 'image/gif';
  }
  if (
    h.length >= 12 &&
    h[0] === 0x52 && // R
    h[1] === 0x49 && // I
    h[2] === 0x46 && // F
    h[3] === 0x46 && // F
    h[8] === 0x57 && // W
    h[9] === 0x45 && // E
    h[10] === 0x42 && // B
    h[11] === 0x50 // P
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Shape of a stored asset key: `<boardId>/<assetId>`, both 22-char base62-like
 * ids. Used by the worker to validate a GET path and by tests to assert on
 * keys.
 */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Compose the R2 key for an uploaded image. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
