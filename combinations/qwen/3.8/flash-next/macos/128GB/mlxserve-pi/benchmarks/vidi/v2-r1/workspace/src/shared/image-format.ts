// Deciding an image's type from its bytes, and naming where it is stored
// (`assets.api`).
//
// The rule this file exists to enforce is that a file is judged by what it *is* and
// never by what it is called or what header it arrived with: a PDF renamed `.png`,
// or an `image/png` `Content-Type` on an SVG, is refused because the bytes say so.
// That is why the decision is made here, from the leading bytes alone, in code both
// the Worker (which serves and stores) and the client can share — and why it lives in
// `src/shared`, where nothing may touch the DOM.
//
// Spec: spec/stories/012-drop-images-onto-the-board/design.md, "Asset upload and
// serving API" (assets.api).
import type { AcceptedImageMime } from './config';

/** One of the accepted image MIME types. */
export type AcceptedImageType = AcceptedImageMime;

/** Read bytes `at..at+len` as a boolean over a fixed signature. */
const bytesMatch = (
  head: Uint8Array,
  at: number,
  signature: readonly number[],
): boolean => {
  if (at < 0 || at + signature.length > head.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (head[at + index] !== signature[index]) return false;
  }
  return true;
};

// PNG: the eight-byte signature is what a decoder starts with; the first four bytes
// alone are unambiguous enough to accept on (`\x89PNG`).
const PNG = [0x89, 0x50, 0x4e, 0x47];
// JPEG: `FFD8FF`, the Start Of Image marker followed by the next marker's leading
// byte — every JPEG on earth starts with these three bytes.
const JPEG = [0xff, 0xd8, 0xff];
// GIF: `GIF87a` or `GIF89a`, the whole version-bearing signature.
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // "GIF87a"
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
// WebP: `RIFF` at 0 and `WEBP` at 8; the four bytes between them are the file size
// and are not looked at. `IMAGE_SNIFF_BYTES` (12) is exactly what this needs.
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP"

/**
 * What kind of accepted image these leading bytes are, or null for anything that
 * is not a PNG, JPEG, GIF or WebP — including an SVG, a PDF, or bytes too short to
 * carry a signature.
 *
 * The answer is made only from the bytes handed in; a caller passes the first
 * `IMAGE_SNIFF_BYTES` of an upload and cannot smuggle a type in through a name or a
 * header. Bytes shorter than a signature simply do not match it, so a truncated
 * header is `null`, not a crash.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (bytesMatch(head, 0, PNG)) return 'image/png';
  if (bytesMatch(head, 0, JPEG)) return 'image/jpeg';
  if (bytesMatch(head, 0, GIF87) || bytesMatch(head, 0, GIF89)) return 'image/gif';
  if (bytesMatch(head, 0, RIFF) && bytesMatch(head, 8, WEBP)) return 'image/webp';
  return null;
}

/**
 * The shape of a stored asset's key: `<boardId>/<assetId>`, both halves a board id
 * (128 random bits, base64url, 22 characters). The asset id is made with
 * `newBoardId()` for exactly that reason — an asset's address is as unguessable as
 * the board it belongs to, and the key can be checked for shape before the bucket is
 * ever asked, so `../` and a wrong-length id are refused without a lookup.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Does this string have the shape of an asset key? No bucket lookup. */
export const isAssetKey = (key: string): boolean => ASSET_KEY_PATTERN.test(key);

/** The key an asset of `assetId` on `boardId` is stored under. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** The board half of a key, or null for a key with no `/` to split. */
export function boardOfAssetKey(key: string): string | null {
  const slash = key.indexOf('/');
  return slash === -1 ? null : key.slice(0, slash);
}

/** The `/api/assets/<key>` an <img> points at for a stored asset. */
export function assetUrl(key: string): string {
  return `/api/assets/${key}`;
}
