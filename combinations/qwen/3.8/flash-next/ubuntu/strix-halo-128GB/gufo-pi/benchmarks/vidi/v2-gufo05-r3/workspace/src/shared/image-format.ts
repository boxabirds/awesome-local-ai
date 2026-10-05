/**
 * Magic-byte image type detection and asset key utilities (story 12).
 */
import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * Detect the image type from the leading bytes of a file body.
 *
 * PNG:  89 50 4E 47 (first 4 bytes)
 * JPEG: FF D8 FF (first 3 bytes)
 * GIF:  "GIF87a" or "GIF89a" (first 6 bytes)
 * WebP: "RIFF" .... "WEBP" (bytes 0-3 and 8-11)
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
  if (head.length >= 6) {
    if (
      head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 &&
      head[3] === 0x38 &&
      (head[4] === 0x37 || head[4] === 0x39) &&
      head[5] === 0x61
    ) {
      return 'image/gif';
    }
  }

  // WebP: RIFF....WEBP
  if (head.length >= 12) {
    if (
      head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
      head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
    ) {
      return 'image/webp';
    }
  }

  return null;
}

/**
 * Pattern for a valid asset key: `<boardId>/<assetId>` where each is 22 base64url chars.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Build the R2 key from a board id and an asset id. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
