/**
 * Image format sniffing and asset key helpers (story 12).
 * Pure functions — no DOM, no React imports.
 */
import { IMAGE_ACCEPTED_TYPES } from './config';
import { BOARD_ID_PATTERN } from './board-id';

export type AcceptedImageType = typeof IMAGE_ACCEPTED_TYPES[number];

/**
 * Detect the image type from the first bytes of a file using magic bytes.
 * - PNG:  89 50 4E 47 0D 0A 1A 0A
 * - JPEG: FF D8 FF
 * - GIF:  GIF87a / GIF89a
 * - WebP: RIFF....WEBP
 * Returns null if the type is not recognised.
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

  // GIF87a / GIF89a
  if (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38) {
    return 'image/gif';
  }

  // WebP: RIFF....WEBP
  if (
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && // RIFF
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50 // WEBP
  ) {
    return 'image/webp';
  }

  return null;
}

/**
 * Pattern for a valid asset key: `<22-char board id>/<22-char asset id>`.
 * Both parts are base64url without padding.
 */
export const ASSET_KEY_PATTERN: RegExp = new RegExp(
  `^${BOARD_ID_PATTERN.source.slice(1, -1)}/${BOARD_ID_PATTERN.source.slice(1, -1)}$`,
);

/**
 * Build the R2 object key for an asset: `<boardId>/<assetId>`.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
