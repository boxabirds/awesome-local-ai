// Image format helpers (story 12, assets.api contract): magic-byte sniffing
// of uploaded bodies and the asset key layout `<boardId>/<assetId>`.

import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * Decide the accepted image type of an upload from its magic bytes only —
 * never from a file name or a client-supplied Content-Type. `head` is the
 * first IMAGE_SNIFF_BYTES of the body. Null for everything else, including
 * SVG (an XML document, not a raster image) and disguised files.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (
    head.length >= 4 &&
    head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
  ) {
    return 'image/png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    head.length >= 6 &&
    head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && // "GIF"
    head[3] === 0x38 && (head[4] === 0x37 || head[4] === 0x39) && // "87"|"89"
    head[5] === 0x61 // "a"
  ) {
    return 'image/gif';
  }
  if (
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && // "RIFF"
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50 // "WEBP"
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * An asset key is `<boardId>/<assetId>` — two 22-char base64url segments
 * (128 bits of randomness each, story 5's newBoardId), so stored addresses
 * are unguessable like board links.
 */
export const ASSET_KEY_PATTERN: RegExp =
  /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** The R2 key of one stored asset. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
