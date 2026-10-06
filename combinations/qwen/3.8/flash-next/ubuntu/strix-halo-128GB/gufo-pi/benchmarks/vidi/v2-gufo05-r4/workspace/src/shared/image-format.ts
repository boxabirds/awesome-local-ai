/**
 * Image format sniffing and asset key utilities.
 *
 * Server-side type detection from magic bytes only — never from file names or
 * Content-Type headers — so a renamed PDF or an SVG cannot smuggle itself onto
 * the board. The client uses the same type list for its own pre-upload checks.
 */

import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * Determine image type from the first bytes of a file.
 * Returns the MIME type or null when the bytes do not match a supported format.
 *
 * Magic bytes:
 * - PNG: 89 50 4E 47 (\x89PNG)
 * - JPEG: FF D8 FF
 * - GIF87a: 47 49 46 38 37 61 (GIF87a)
 * - GIF89a: 47 49 46 38 39 61 (GIF89a)
 * - WebP: 52 49 46 46 .... 57 45 42 50 (RIFF....WEBP)
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head.length < 4) return null;

  // PNG: first 4 bytes are 89 50 4E 47
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }

  // JPEG: first 3 bytes are FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: first 6 bytes are "GIF87a" or "GIF89a"
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
    if ((head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61) {
      return 'image/gif';
    }
  }

  // WebP: "RIFF" at 0-3 and "WEBP" at 8-11
  if (
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/** Pattern that a valid asset key must match: `<22 base64url chars>/<22 base64url chars>`. */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Build an asset key from a board id and an asset id. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
