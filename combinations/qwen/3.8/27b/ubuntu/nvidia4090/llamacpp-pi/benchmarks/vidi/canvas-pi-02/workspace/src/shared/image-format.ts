/**
 * Image format utilities (story 12, assets.api).
 *
 * `sniffImageType` inspects the first IMAGE_SNIFF_BYTES of a file and
 * returns the accepted MIME type or null (SVG, PDF, corrupt data → null).
 * The type is decided from content only, never from the file name or the
 * client's Content-Type header (image.types security rule).
 *
 * `ASSET_KEY_PATTERN` and `assetKeyFor` produce and validate the
 * unguessable R2 object keys (`<boardId>/<assetId>`, both 22-char base64url).
 */

import { IMAGE_SNIFF_BYTES, IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * Inspect the head bytes of a file and return the accepted image type,
 * or null when the content is not a supported raster image.
 *
 * Signatures checked (in order):
 *  - PNG:  89 50 4E 47
 *  - JPEG: FF D8 FF
 *  - GIF:  47 49 46 38 (37|39) 61  ("GIF8" + "7a"/"9a")
 *  - WebP: 52 49 46 46 ... 57 45 42 50  ("RIFF" ... "WEBP")
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head.length < 4) return null;

  // PNG: 89 50 4E 47
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) {
    return 'image/png';
  }

  // JPEG: FF D8 FF
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'image/jpeg';
  }

  // GIF87a or GIF89a
  if (
    head[0] === 0x47 && // G
    head[1] === 0x49 && // I
    head[2] === 0x46 && // F
    head[3] === 0x38 && // 8
    (head[4] === 0x37 || head[4] === 0x39) && // 7 or 9
    head.length >= 6 && head[5] === 0x61 // a
  ) {
    return 'image/gif';
  }

  // WebP: RIFF....WEBP (offset 0-3: "RIFF", offset 8-11: "WEBP")
  if (
    head.length >= IMAGE_SNIFF_BYTES &&
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
 * Exact shape of an asset key: `<boardId>/<assetId>` where both parts are
 * 22-character base64url strings (128 bits each).
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Compose the R2 object key for a board asset. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
