import { IMAGE_SNIFF_BYTES, IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = typeof IMAGE_ACCEPTED_TYPES[number];

/**
 * Sniff image type from the first IMAGE_SNIFF_BYTES of a file.
 * Returns null for unsupported or non-image content (SVG text, PDF, random bytes).
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head.length < 4) return null;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    head[0] === 0x89 &&
    head[1] === 0x50 &&
    head[2] === 0x4e &&
    head[3] === 0x47
  ) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (
    head[0] === 0xff &&
    head[1] === 0xd8 &&
    head[2] === 0xff
  ) {
    return 'image/jpeg';
  }

  // GIF: GIF87a or GIF89a
  if (
    head[0] === 0x47 &&
    head[1] === 0x49 &&
    head[2] === 0x46
  ) {
    if (
      (head[3] === 0x38 && head[4] === 0x37 && head[5] === 0x61) ||
      (head[3] === 0x38 && head[4] === 0x39 && head[5] === 0x61)
    ) {
      return 'image/gif';
    }
  }

  // WebP: RIFF....WEBP
  if (
    head[0] === 0x52 &&
    head[1] === 0x49 &&
    head[2] === 0x46 &&
    head[3] === 0x46
  ) {
    // Look for "WEBP" at offset 8
    if (
      head[8] === 0x57 &&
      head[9] === 0x45 &&
      head[10] === 0x42 &&
      head[11] === 0x50
    ) {
      return 'image/webp';
    }
  }

  return null;
}

/** Asset key pattern: ^[A-Za-z0-9_-]{22}/[A-Za-z0-9_-]{22}$ */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Build an asset key from boardId and assetId */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
