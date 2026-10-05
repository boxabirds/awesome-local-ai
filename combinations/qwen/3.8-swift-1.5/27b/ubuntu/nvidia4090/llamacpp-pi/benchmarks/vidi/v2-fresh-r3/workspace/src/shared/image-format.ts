import { IMAGE_ACCEPTED_TYPES } from './config';

/**
 * Image format sniffing (story 12, assets.api). A file is an accepted image
 * only if its content (magic bytes) says so — never the file name or the
 * client's Content-Type.
 */

/** The accepted image MIME types (config IMAGE_ACCEPTED_TYPES). */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * Sniffs the image type from the first bytes of a file:
 * PNG `89 50 4E 47`, JPEG `FF D8 FF`, GIF `GIF87a`/`GIF89a`, WebP
 * `RIFF .... WEBP`. Returns null for anything else (SVG, PDF, random bytes).
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (!head || head.length < 4) return null;
  // PNG: 89 50 4E 47
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF87a / GIF89a
  if (
    head.length >= 6 &&
    head[0] === 0x47 && // G
    head[1] === 0x49 && // I
    head[2] === 0x46 && // F
    head[3] === 0x38 && // 8
    (head[4] === 0x37 || head[4] === 0x39) && // 7 | 9
    head[5] === 0x61 // a
  ) {
    return 'image/gif';
  }
  // WebP: RIFF .... WEBP
  if (
    head.length >= 12 &&
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
  return null;
}

/**
 * The R2 asset key pattern: `<boardId>/<assetId>`, each a 22-char base64url
 * id (128 bits, unguessable — story 5's board id shape).
 */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** The R2 key for a board asset: `<boardId>/<assetId>`. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
