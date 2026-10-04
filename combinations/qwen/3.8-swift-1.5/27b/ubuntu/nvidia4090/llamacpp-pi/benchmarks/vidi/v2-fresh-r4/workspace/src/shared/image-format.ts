/**
 * Image format sniffing and asset key helpers (story 12).
 * Pure functions, no DOM imports.
 */
import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = typeof IMAGE_ACCEPTED_TYPES[number];

/**
 * Determine the image type from the leading bytes of a file.
 * Returns the accepted MIME type string, or null if not a recognised raster image.
 *
 * Magic bytes:
 *   PNG:  89 50 4E 47 0D 0A 1A 0A
 *   JPEG: FF D8 FF
 *   GIF:  47 49 46 38 37 61 ("GIF87a") or 47 49 46 38 39 61 ("GIF89a")
 *   WebP: 52 49 46 46 .. .. .. .. 57 45 42 50 ("RIFF....WEBP")
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

  // GIF: "GIF87a" or "GIF89a"
  if (
    head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 &&
    head[3] === 0x38 &&
    (head[4] === 0x37 || head[4] === 0x39) &&
    head[5] === 0x61
  ) {
    return 'image/gif';
  }

  // WebP: "RIFF" at 0-3, "WEBP" at 8-11
  if (
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Pattern for a valid asset key: `<22-char-board-id>/<22-char-asset-id>`.
 * Both parts are base64url without padding (same as board ids).
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/**
 * Build an asset key from a board id and an asset id.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
