// Image asset format helpers (spec: assets.api).
//
// sniffImageType decides an upload's type from its first bytes ALONE
// (image.types: content, never the client's Content-Type header).
// ASSET_KEY_PATTERN guards the serve route: only well-formed
// `<boardId>/<assetId>` keys (story 5's 22-char 128-bit ids on each side)
// are served; anything else — including path traversal — 404s.

import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** `<boardId>/<assetId>`, both story 5 22-char base64url ids. */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/**
 * Magic-byte sniff of the first IMAGE_SNIFF_BYTES (more is ignored):
 * PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF87a/GIF89a, WebP `RIFF....WEBP`.
 * Null for everything else (SVG, PDF, truncated, random bytes …).
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const at = (i: number): number => (i < head.length ? head[i]! : -1);
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
    return 'image/png';
  }
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) {
    return 'image/jpeg';
  }
  if (
    at(0) === 0x47 && // G
    at(1) === 0x49 && // I
    at(2) === 0x46 && // F
    at(3) === 0x38 && // 8
    (at(4) === 0x37 || at(4) === 0x39) && // 7 / 9
    at(5) === 0x61 // a
  ) {
    return 'image/gif';
  }
  if (
    at(0) === 0x52 && // R
    at(1) === 0x49 && // I
    at(2) === 0x46 && // F
    at(3) === 0x46 && // F
    at(8) === 0x57 && // W
    at(9) === 0x45 && // E
    at(10) === 0x42 && // B
    at(11) === 0x50 // P
  ) {
    return 'image/webp';
  }
  return null;
}
