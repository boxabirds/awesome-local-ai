import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * Detects the image type of a file from its first bytes (magic bytes only —
 * never from the file name or the client's Content-Type).
 * PNG 89 50 4E 47, JPEG FF D8 FF, GIF87a/GIF89a, WebP RIFF....WEBP.
 * Returns null for anything else (SVG, PDF, corrupt data, ...).
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const h = head.subarray(0, Math.min(IMAGE_SNIFF_BYTES, head.length));
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (h.length >= 8 && h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (h.length >= 3 && h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF87a / GIF89a
  if (h.length >= 6 && h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x38) {
    if (h[4] === 0x37 && h[5] === 0x61) return 'image/gif';
    if (h[4] === 0x39 && h[5] === 0x61) return 'image/gif';
  }
  // WebP: "RIFF" + 4-byte size + "WEBP"
  if (
    h.length >= 12 &&
    h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 &&
    h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** `<boardId>/<assetId>` where both are 22-char base64url ids (story 5). */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Builds the unguessable R2 key for a stored asset. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
