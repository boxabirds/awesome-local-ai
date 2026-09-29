import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * Detects image type from magic bytes. Only uses the first 12 bytes.
 * Returns the MIME type string, or null if unrecognized.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head.length >= 4) {
    // PNG: 89 50 4E 47
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
      return 'image/png';
    }
  }

  if (head.length >= 3) {
    // JPEG: FF D8 FF
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
      return 'image/jpeg';
    }
  }

  if (head.length >= 6) {
    // GIF87a or GIF89a
    if (
      head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 &&
      head[3] === 0x38 &&
      (head[4] === 0x37 || head[4] === 0x39) &&
      head[5] === 0x61
    ) {
      return 'image/gif';
    }
  }

  if (head.length >= 12) {
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

/** Pattern matching a valid asset key: `<22-char-boardId>/<22-char-assetId>` */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Build an R2 key from a board id and asset id. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
