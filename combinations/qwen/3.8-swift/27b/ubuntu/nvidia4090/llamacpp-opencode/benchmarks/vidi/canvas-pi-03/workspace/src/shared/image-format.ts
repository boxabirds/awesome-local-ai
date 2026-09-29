/**
 * Story 12: magic-byte image sniffing and asset key rules (assets.api unit,
 * TC-01/TC-02).
 *
 * `sniffImageType` inspects only the first IMAGE_SNIFF_BYTES of the uploaded
 * content — never the client Content-Type header — so a PDF renamed to
 * .png (or any forged header) is rejected.
 */
import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** Matches exactly `<22 base64url chars>/<22 base64url chars>` — no slashes, dots or traversal. */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Builds the immutable R2 key for an image uploaded to a board. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/**
 * Classifies an image by its magic bytes.
 *
 * PNG:  89 50 4E 47 0D 0A 1A 0A
 * JPEG: FF D8 FF
 * GIF:  47 49 46 38 37 61 | 47 49 46 38 39 61  (GIF87a / GIF89a)
 * WebP: 52 49 46 46 .. .. .. .. 57 45 42 50    (RIFF....WEBP)
 *
 * @returns the accepted content type, or null for anything else.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const b = head;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    b.length >= 6 &&
    b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61
  ) {
    return 'image/gif';
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}
