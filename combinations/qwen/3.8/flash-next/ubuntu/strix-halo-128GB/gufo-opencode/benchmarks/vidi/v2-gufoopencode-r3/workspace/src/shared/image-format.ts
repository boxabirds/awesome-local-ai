import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

// Magic-byte signatures checked against the first IMAGE_SNIFF_BYTES of a body.
// The type is decided from content only, never from a file name or
// Content-Type, so a renamed PDF or an SVG text file is refused.
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47]; // 89 50 4E 47
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const GIF87A_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // "GIF87a"
const GIF89A_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at offset 8

function matches(head: Uint8Array, magic: readonly number[], offset = 0): boolean {
  if (head.length < offset + magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (head[offset + i] !== magic[i]) return false;
  }
  return true;
}

export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (matches(head, PNG_MAGIC)) return 'image/png';
  if (matches(head, JPEG_MAGIC)) return 'image/jpeg';
  if (matches(head, GIF87A_MAGIC) || matches(head, GIF89A_MAGIC)) return 'image/gif';
  if (matches(head, RIFF_MAGIC) && matches(head, WEBP_MAGIC, 8)) return 'image/webp';
  return null;
}

// Keys are "<boardId>/<assetId>", both 22-char base64url ids (story 5), so
// no traversal or wildcard characters can ever appear in one.
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
