// Image format helpers (story 12, assets.api): magic-byte type sniffing and
// asset key construction. The sniff is the SINGLE source of truth for the
// accepted type (image.types): the client's File.type and any
// Content-Type header are never trusted.

import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * Sniffs the image type from the first bytes of the file. Accepts exactly
 * PNG (89 50 4E 47), JPEG (FF D8 FF), GIF87a/GIF89a and WebP
 * (RIFF....WEBP); anything else — including SVG (scriptable, must never be
 * stored or served) and files whose extension lies about the content —
 * returns null.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  // PNG: 89 50 4E 47
  if (head.length >= 4 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF (any marker after SOI)
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF87a / GIF89a
  if (
    head.length >= 6 &&
    head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x38 &&
    (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61
  ) {
    return 'image/gif';
  }
  // WebP: RIFF <4-byte size> WEBP
  if (
    head.length >= 12 &&
    head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 &&
    head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

/** `<boardId>/<assetId>`: both 22-char base64url ids (story 5 newBoardId,
 *  128 bits), so stored keys are unguessable (assets.api). */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** The R2 key for a board's asset. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
