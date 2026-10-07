/**
 * Story 12 — Image format sniffing and asset key helpers.
 *
 * Magic-byte based detection of supported image types (PNG, JPEG, GIF, WebP).
 */
import { IMAGE_SNIFF_BYTES } from './config';

export type AcceptedImageType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

/**
 * Check if a string matches the expected asset key pattern:
 * `<22 base64url chars>/<22 base64url chars>`
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/**
 * Build an asset key from board id and asset id.
 * Both parts must be valid base64url (22 chars each for 128-bit IDs).
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/**
 * Sniff the image type from the first IMAGE_SNIFF_BYTES of a Uint8Array.
 * Returns null if the type is not one of the accepted image types.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head.length < 4) return null;

  // PNG: starts with 89 50 4E 47
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }

  // JPEG: starts with FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF: starts with "GIF"
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) {
    // GIF87a or GIF89a
    return 'image/gif';
  }

  // WebP: RIFF....WEBP (offset 0-3: RIFF, offset 8-11: WEBP)
  if (head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46) {
    if (head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50) {
      return 'image/webp';
    }
  }

  return null;
}
