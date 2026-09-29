/**
 * Raster image type sniffing and asset key helpers (story 12, assets.api).
 *
 * The server decides an uploaded file's type from its CONTENT (magic bytes),
 * never from the client-supplied Content-Type header, so a renamed PDF or an
 * SVG with a script tag cannot be stored or served as an image.
 *
 * This module is dependency-free (only reads a byte prefix and builds strings)
 * so the Worker and the client share the exact same rules.
 */
import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from '@/shared/config';

export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * The set of accepted MIME types, re-exported for callers (e.g. the client's
 * picker `accept` filter and the client-side pre-check).
 */
export { IMAGE_ACCEPTED_TYPES };

/**
 * Sniffs the raster image type from the first IMAGE_SNIFF_BYTES of `head`.
 *
 * Signatures (design "magic-byte type sniffing"):
 *  - PNG  : 89 50 4E 47 0D 0A 1A 0A  (first 4 bytes 89 50 4E 47)
 *  - JPEG : FF D8 FF
 *  - GIF  : 47 49 46 38 37 61 ("GIF87a") or 47 49 46 38 39 61 ("GIF89a")
 *  - WebP : 52 49 46 46 .... 57 45 42 50 ("RIFF....WEBP")
 *
 * Returns null for anything else (SVG text, a renamed PDF, video, audio,
 * truncation, …). `head` may be shorter than IMAGE_SNIFF_BYTES; the sniff is
 * prefix-based and safe on short input.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const b = head;
  const len = b.length;
  // PNG: 89 50 4E 47
  if (len >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'image/png';
  }
  // JPEG: FF D8 FF
  if (len >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return 'image/jpeg';
  }
  // GIF87a / GIF89a
  if (
    len >= 6 &&
    b[0] === 0x47 && // G
    b[1] === 0x49 && // I
    b[2] === 0x46 && // F
    b[3] === 0x38 && // 8
    (b[4] === 0x37 || b[4] === 0x39) && // 7 / 9
    b[5] === 0x61 // a
  ) {
    return 'image/gif';
  }
  // WebP: "RIFF" (0..3) + 4 size bytes + "WEBP" (8..11)
  if (
    len >= IMAGE_SNIFF_BYTES &&
    b[0] === 0x52 && // R
    b[1] === 0x49 && // I
    b[2] === 0x46 && // F
    b[3] === 0x46 && // F
    b[8] === 0x57 && // W
    b[9] === 0x45 && // E
    b[10] === 0x42 && // B
    b[11] === 0x50 // P
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * A full asset key: `<boardId>/<assetId>`. Both parts are 22-char base64url
 * ids (story 5's newBoardId), so keys are unguessable and contain no path
 * separators or metacharacters. Serving rejects any key that does not match
 * this pattern (image.unavailable, traversal protection).
 */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Builds the R2 object key for an asset (design: `assetKeyFor`). */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
