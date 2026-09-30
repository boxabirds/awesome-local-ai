import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from '@shared/config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

// Magic byte patterns for accepted image types
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]; // 89 50 4E 47
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const GIF87a = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // "GIF87a"
const GIF89a = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

function startsWith(head: Uint8Array, magic: number[]): boolean {
  if (head.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (head[i] !== magic[i]) return false;
  }
  return true;
}

/**
 * Determine image type from magic bytes. Returns the accepted type or null if not recognized.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, PNG_MAGIC)) return 'image/png';
  if (startsWith(head, JPEG_MAGIC)) return 'image/jpeg';
  if (startsWith(head, GIF87a) || startsWith(head, GIF89a)) return 'image/gif';
  // WebP: RIFF????WEBP (bytes 0-3 RIFF, bytes 8-11 WEBP)
  if (startsWith(head, RIFF) && head.length >= 12 && startsWith(head.slice(8, 12), WEBP)) {
    return 'image/webp';
  }
  return null;
}

/**
 * Pattern for valid asset keys: two base64url tokens of 22 chars separated by '/'.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/**
 * Build an asset key from board and asset ids.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

export { IMAGE_SNIFF_BYTES };
