/** Image format helpers for story 12 — magic-byte sniffing and key generation */

import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

/** A supported raster image type. */
export type AcceptedImageType = typeof IMAGE_ACCEPTED_TYPES[number];

/**
 * Magic-byte patterns for known image formats.
 * PNG: 89 50 4E 47 0D 0A 1A 0A followed by IHDR chunk signature (00 00 00 0D)
 * JPEG: FF D8 FF (any subsequent byte except 0x00 or 0x01 which are padding/JFIF markers)
 * GIF: "GIF8" followed by "7a" or "9a"
 * WebP: RIFF....WEBP (offset 8)
 */

/**
 * Sniff an image type from the first IMAGE_SNIFF_BYTES of a file's body.
 * Returns the MIME type string if recognised, null otherwise.
 * Ignores Content-Type, filename, etc. — pure content-based detection.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  // Need at least 4 bytes minimum
  if (head.length < 4) return null;

  // PNG: starts with 89 50 4E 47 0D 0A 1A 0A
  if (
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  ) {
    const sig = [head[4], head[5], head[6], head[7]];
    if (sig[0] === 0x0d && sig[1] === 0x0a && sig[2] === 0x1a && sig[3] === 0x0a) {
      return 'image/png';
    }
    return null;
  }

  // JPEG: FFD8FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: starts with "GIF8", then '7' or '9'
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
    if (head[4] === 0x37 || head[4] === 0x39) {
      return 'image/gif';
    }
    return null;
  }

  // WebP: "RIFF" at offset 0, "WEBP" at offset 8
  if (head.length >= 12) {
    if (
      head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
    ) {
      if (
        head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
      ) {
        return 'image/webp';
      }
    }
  }

  return null;
}

/** Validates that an asset key matches `<boardId>/<assetId>` where each is base64url-22. */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Build an unguessable asset key from board id and asset id. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** Check if an asset key is well-formed (two base64url segments separated by `/`). */
export function isValidAssetKey(key: string): boolean {
  return ASSET_KEY_PATTERN.test(key);
}
