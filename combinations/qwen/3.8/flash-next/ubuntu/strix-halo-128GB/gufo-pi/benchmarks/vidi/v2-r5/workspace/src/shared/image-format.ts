/**
 * Image format detection via magic bytes and asset key validation.
 */

import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * Sniff the image type from the first bytes of a file.
 * Returns the MIME type or null if not a supported image format.
 *
 * Magic bytes:
 *   PNG:  89 50 4E 47 (first 4 bytes)
 *   JPEG: FF D8 FF (first 3 bytes)
 *   GIF:  "GIF87a" or "GIF89a" (first 6 bytes)
 *   WebP: "RIFF" at 0-3, "WEBP" at 8-11
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head.length < 3) return null;

  // PNG: 89 50 4E 47
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: "GIF87a" or "GIF89a"
  if (head.length >= 6) {
    const sig = String.fromCharCode(head[0]!, head[1]!, head[2]!, head[3]!, head[4]!, head[5]!);
    if (sig === 'GIF87a' || sig === 'GIF89a') {
      return 'image/gif';
    }
  }

  // WebP: "RIFF" at offset 0, "WEBP" at offset 8
  if (head.length >= 12) {
    const riff = String.fromCharCode(head[0]!, head[1]!, head[2]!, head[3]!);
    const webp = String.fromCharCode(head[8]!, head[9]!, head[10]!, head[11]!);
    if (riff === 'RIFF' && webp === 'WEBP') {
      return 'image/webp';
    }
  }

  return null;
}

/** Pattern a valid asset key must match: `<22-char-boardId>/<22-char-assetId>` */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Build an asset key from a board id and an asset id. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
