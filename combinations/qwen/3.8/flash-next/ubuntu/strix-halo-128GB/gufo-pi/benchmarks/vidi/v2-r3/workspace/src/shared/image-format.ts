import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';
import type { AcceptedImageType } from './config';

export type { AcceptedImageType };

/**
 * Sniff the first IMAGE_SNIFF_BYTES of a file to determine its image type.
 * Returns null if the type is not one of the accepted image types.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head.length < 3) return null;

  // PNG: 89 50 4E 47
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) {
    return 'image/jpeg';
  }

  // GIF: GIF87a or GIF89a (first 6 bytes)
  if (head.length >= 6 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
    if (head[4] === 0x37 && head[5] === 0x61) return 'image/gif'; // GIF87a
    if (head[4] === 0x39 && head[5] === 0x61) return 'image/gif'; // GIF89a
  }

  // WebP: RIFF....WEBP
  if (head.length >= 12 &&
      head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
      head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
    return 'image/webp';
  }

  return null;
}

/**
 * Pattern for a valid asset key: boardId/assetId where both are 22-char base64url.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/**
 * Build the R2 key for an asset.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
