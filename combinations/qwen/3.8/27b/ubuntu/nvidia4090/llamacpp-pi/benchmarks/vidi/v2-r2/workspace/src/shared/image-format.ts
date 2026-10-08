/**
 * Image type sniffing and asset key helpers (story 12, design assets.api).
 *
 * `sniffImageType` identifies an image from its first bytes (magic bytes),
 * never from the file name or Content-Type header. This is the security
 * boundary: SVGs, PDFs and other non-raster files are refused regardless
 * of their extension or declared type.
 *
 * Asset keys follow story 5's unguessable id scheme: both boardId and
 * assetId are 22-char base64url strings (128 bits of randomness each).
 */

import { IMAGE_SNIFF_BYTES } from './config';

/** An image MIME type the product accepts. */
export type AcceptedImageType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp';

/**
 * Asset key pattern: `<boardId>/<assetId>` where each part is a valid
 * board id (22 chars of base64url).
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Builds the asset key from a board id and an asset id. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/**
 * Identifies an image from its first IMAGE_SNIFF_BYTES.
 * Returns null for anything that is not a recognized raster image
 * (PNG, JPEG, GIF87a, GIF89a, WebP).
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const len = head.length;
  if (len < 4) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (len >= 8) {
    if (
      head[0] === 0x89 &&
      head[1] === 0x50 &&
      head[2] === 0x4e &&
      head[3] === 0x47 &&
      head[4] === 0x0d &&
      head[5] === 0x0a &&
      head[6] === 0x1a &&
      head[7] === 0x0a
    ) {
      return 'image/png';
    }
  }

  // JPEG: FF D8 FF
  if (len >= 3) {
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
      return 'image/jpeg';
    }
  }

  // GIF87a or GIF89a: "GIF8"
  if (len >= 6) {
    if (
      head[0] === 0x47 && // G
      head[1] === 0x49 && // I
      head[2] === 0x46 && // F
      head[3] === 0x38 && // 8
      (head[4] === 0x37 || head[4] === 0x39) && // 7 or 9
      head[5] === 0x61 // a
    ) {
      return 'image/gif';
    }
  }

  // WebP: "RIFF"...."WEBP"
  if (len >= 12) {
    if (
      head[0] === 0x52 && // R
      head[1] === 0x49 && // I
      head[2] === 0x46 && // F
      head[3] === 0x46 && // F
      head[8] === 0x57 && // W
      head[9] === 0x45 && // E
      head[10] === 0x42 && // B
      head[11] === 0x50 // P
    ) {
      return 'image/webp';
    }
  }

  return null;
}
