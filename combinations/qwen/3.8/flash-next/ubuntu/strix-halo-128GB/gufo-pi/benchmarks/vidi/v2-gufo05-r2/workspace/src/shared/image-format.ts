/**
 * Story 12: image format detection by magic bytes, and asset key validation.
 *
 * The server decides an uploaded file's type from the first IMAGE_SNIFF_BYTES only,
 * never from the file name or Content-Type header, so a renamed PDF or an SVG carrying
 * a script tag is refused before anything is stored.
 */

import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * Pattern for a valid asset key: `<boardId>/<assetId>`, both 22 base64url characters.
 */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/**
 * Build the R2 key for an asset.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/**
 * Detect the image type from the leading bytes of a file (magic bytes / file signature).
 * Returns null for any type not in IMAGE_ACCEPTED_TYPES (including SVG, PDF, video, etc).
 *
 * Signatures checked:
 *   PNG:  89 50 4E 47 0D 0A 1A 0A (first 4 suffice: 89 50 4E 47)
 *   JPEG: FF D8 FF
 *   GIF:  "GIF87a" or "GIF89a" (first 6 bytes)
 *   WebP: "RIFF" at offset 0, "WEBP" at offset 8
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head.length < 4) return null;

  // PNG: 89 50 4E 47
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: "GIF87a" or "GIF89a" (first 6 bytes)
  if (
    head.length >= 6 &&
    head[0] === 0x47 && // G
    head[1] === 0x49 && // I
    head[2] === 0x46 && // F
    head[3] === 0x38 && // 8
    ((head[4] === 0x37 && head[5] === 0x61) || (head[4] === 0x39 && head[5] === 0x61))
    // 7a ("7a") or 39 61 ("9a")
  ) {
    return 'image/gif';
  }

  // WebP: RIFF....WEBP
  if (
    head.length >= 12 &&
    head[0] === 0x52 && // R
    head[1] === 0x49 && // I
    head[2] === 0x46 && // F
    head[3] === 0x46 && // F
    head[8] === 0x57 && // W
    head[9] === 0x45 && // E
    head[10] === 0x42 && // B
    head[11] === 0x50 // P
  ) {
    return 'image/webp';
  }

  return null;
}
