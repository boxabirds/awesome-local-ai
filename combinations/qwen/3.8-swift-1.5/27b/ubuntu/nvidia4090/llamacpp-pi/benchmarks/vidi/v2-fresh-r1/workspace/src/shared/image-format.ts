// Image format detection via magic bytes and asset key helpers.
// Shared between worker (upload validation) and client.

import { IMAGE_ACCEPTED_TYPES, type AcceptedImageType } from './config';

/**
 * Sniff the image type from the first bytes of the file content.
 * Returns the accepted MIME type or null if not a recognized image format.
 *
 * Magic bytes:
 * - PNG:  89 50 4E 47 0D 0A 1A 0A
 * - JPEG: FF D8 FF
 * - GIF:  GIF87a / GIF89a
 * - WebP: RIFF .... WEBP
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

  // GIF: 'GIF87a' or 'GIF89a'
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
    if (head[4] === 0x37 && head[5] === 0x61) return 'image/gif'; // GIF87a
    if (head[4] === 0x39 && head[5] === 0x61) return 'image/gif'; // GIF89a
  }

  // WebP: 'RIFF' .... 'WEBP' (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  if (
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}

/** Pattern for a valid asset key: <22-char boardId>/<22-char assetId>. */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Build an asset key from board id and asset id. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
