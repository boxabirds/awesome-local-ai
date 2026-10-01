/**
 * Image format detection and asset key utilities.
 */
import { IMAGE_ACCEPTED_TYPES, type AcceptedImageType } from './config';
void IMAGE_ACCEPTED_TYPES; // re-exported via type

/**
 * Detect image type from the first bytes of a file (magic bytes).
 * Returns the MIME type or null if not a supported image.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head.length >= 8) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4E && head[3] === 0x47) {
      return 'image/png';
    }
    // JPEG: FF D8 FF
    if (head[0] === 0xFF && head[1] === 0xD8 && head[2] === 0xFF) {
      return 'image/jpeg';
    }
    // GIF87a or GIF89a: 47 49 46 38 37 61 or 47 49 46 38 39 61
    if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
      if ((head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61) {
        return 'image/gif';
      }
    }
    // WebP: RIFF....WEBP
    if (
      head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
      head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
    ) {
      return 'image/webp';
    }
  }
  return null;
}

/** Pattern matching a valid asset key: boardId/assetId, each 22 base64url chars. */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Construct an asset key from board and asset ids. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
