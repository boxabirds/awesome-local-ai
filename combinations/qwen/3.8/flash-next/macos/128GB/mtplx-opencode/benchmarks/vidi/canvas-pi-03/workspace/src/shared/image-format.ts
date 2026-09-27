// Image type sniffing + asset keys (story 12, contract `assets.api`).
//
// Two things live here, both pure and shared by the Worker and the browser so
// they can never disagree:
//
//   * `sniffImageType` decides an image's type from its CONTENT (magic bytes),
//     never from a file name or the client's `Content-Type`. This is what makes
//     "PNG, JPEG, GIF and WebP only" a real rule: a PDF renamed `.png`, an SVG
//     (which can carry script) and a random blob all sniff to `null`.
//   * the asset-key shape. A key is `boardId/assetId` where both parts are the
//     22-character base64url ids `newBoardId()` produces, so a key doubles as the
//     R2 object key AND the URL path, and both halves are individually a valid,
//     unguessable board/asset id. `ASSET_KEY_PATTERN` is checked before any
//     storage lookup so a traversal attempt (`../../etc/passwd`) is rejected as
//     just another malformed key and never reaches R2.

import { IMAGE_ACCEPTED_TYPES } from './config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** True when `head` starts with `bytes`. Reads only the bytes it needs. */
function startsWith(head: Uint8Array, bytes: number[]): boolean {
  if (head.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (head[i] !== bytes[i]) return false;
  }
  return true;
}

/**
 * Identify an image by its leading bytes. `head` is the first `IMAGE_SNIFF_BYTES`
 * bytes of a file (12 is enough: WebP needs `RIFF` + `WEBP`, everything else is
 * a shorter prefix). Returns the accepted MIME type, or `null` for anything that
 * is not one of the four accepted raster formats — including SVG, PDF and
 * disguised files, which is the whole point (image.types).
 *
 *   PNG  : 89 50 4E 47 (‰PNG)
 *   JPEG : FF D8 FF (SOI followed by a marker)
 *   GIF  : "GIF87a" / "GIF89a"
 *   WebP : "RIFF" … "WEBP"
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  // PNG. The four-byte signature is enough; IHDR follows for the size decode.
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  // JPEG SOI (FF D8) immediately followed by a marker byte (FF ..).
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  // GIF87a / GIF89a.
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])) return 'image/gif';
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) return 'image/gif';
  // WebP: "RIFF" at 0 and "WEBP" at 8. A longer head is required.
  if (head.length >= 12 && startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head.subarray(8), [0x57, 0x45, 0x42, 0x50])) {
    return 'image/webp';
  }
  return null;
}

/** The asset-key shape: `<22 base64url chars>/<22 base64url chars>`. Both halves
 * are exactly the shape `newBoardId()` produces, so `assetKeyFor` output always
 * matches, and a key that does not match is malformed (→ 404 before R2). */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Build the storage key (and, with the route prefix, the public URL) for one
 * asset. The board id keeps every board's files in its own namespace. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** True when `key` is a well-formed asset key. */
export function isValidAssetKey(key: string): boolean {
  return ASSET_KEY_PATTERN.test(key);
}
