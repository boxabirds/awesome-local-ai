// src/shared/image-format.ts
// Magic-byte image type sniffing and asset key generation.

import { IMAGE_ACCEPTED_TYPES } from './config';
import { BOARD_ID_PATTERN } from './board-id';

export type AcceptedImageType = typeof IMAGE_ACCEPTED_TYPES[number];

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]; // 89 50 4E 47
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // GIF87a
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // GIF89a
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // RIFF
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]; // WEBP

function startsWith(head: Uint8Array, magic: number[]): boolean {
  if (head.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (head[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Sniff the image type from the first IMAGE_SNIFF_BYTES of the file content.
 * Returns the MIME type if recognized, null otherwise.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head.length < 4) return null;

  if (startsWith(head, PNG_MAGIC)) return 'image/png';
  if (startsWith(head, JPEG_MAGIC)) return 'image/jpeg';
  if (startsWith(head, GIF87A) || startsWith(head, GIF89A)) return 'image/gif';

  // WebP: RIFF....WEBP (bytes 0-3 = RIFF, bytes 8-11 = WEBP)
  if (head.length >= 12 && startsWith(head, RIFF_MAGIC) && startsWith(head.subarray(8), WEBP_MAGIC)) {
    return 'image/webp';
  }

  return null;
}

/**
 * Pattern for a valid asset key: <boardId>/<assetId> where both are 22-char base64url.
 */
export const ASSET_KEY_PATTERN: RegExp = new RegExp(
  `^${BOARD_ID_PATTERN.source.slice(1, -1)}/${BOARD_ID_PATTERN.source.slice(1, -1)}$`
);

/**
 * Builds an asset key from board and asset ids.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
