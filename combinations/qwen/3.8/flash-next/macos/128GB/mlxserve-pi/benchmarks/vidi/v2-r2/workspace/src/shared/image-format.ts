// Telling an image format from the bytes at the start of a file, and the one shape
// an asset key is allowed to have.
//
// This is the Worker's answer, not the client's: a request that says
// `Content-Type: image/png` and carries a PDF is stored as a PDF unless the bytes are
// read (PRD: "the file is not stored at all"). Every one of the four accepted formats
// states its format in its first bytes, so no parsing library and no file extension is
// needed - and an extension is worth nothing here anyway, which is why a renamed PDF is
// refused rather than guessed at.
//
// `IMAGE_SNIFF_BYTES` is 12 because that is how far WebP reaches: `RIFF` at byte 0 and
// `WEBP` at byte 8. A body shorter than that cannot be any of the four, so a three-byte
// body is refused rather than examined.

import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config';

/** The Content-Types an image may have - the accepted list, unchanged. */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * A stored asset's location in the bucket and in its URL: `<boardId>/<assetId>`, both
 * ids the 22-character base64url form `newBoardId()` makes. Board-first, so one board's
 * assets are one prefix. Nothing else is a key - in particular no `../` is, so a request
 * can never name an object outside the board it is asking about.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

export function isValidAssetKey(key: string): boolean {
  return ASSET_KEY_PATTERN.test(key);
}

/** The key of one asset of one board. Both parts must already be valid ids. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** The URL an asset is served at, which is its key with a route in front of it. */
export function assetUrlFor(key: string): string {
  return `/api/assets/${key}`;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  if (at + signature.length > bytes.length) return false;
  for (let index = 0; index < signature.length; index += 1) {
    if (bytes[at + index] !== signature[index]) return false;
  }
  return true;
}

const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const jpeg = [0xff, 0xd8, 0xff];
const gif87a = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const gif89a = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const riff = [0x52, 0x49, 0x46, 0x46]; // 'RIFF' - WebP carries 'WEBP' 8 bytes later
const webp = [0x57, 0x45, 0x42, 0x50];

/**
 * The format these bytes start with, or null when they are not one of the four.
 *
 * Only the first `IMAGE_SNIFF_BYTES` bytes are looked at, so the argument may be the
 * whole body or just its front; a body too short to hold a signature is not an image.
 * An SVG (which starts as text), a PDF (which starts `%PDF`) and a renamed anything are
 * all null: the signature has to be one of the four, not merely "not known to be wrong".
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const bytes =
    head.length > IMAGE_SNIFF_BYTES ? head.subarray(0, IMAGE_SNIFF_BYTES) : head;
  if (bytes.length < IMAGE_SNIFF_BYTES) return null;

  if (startsWith(bytes, png)) return 'image/png';
  if (startsWith(bytes, jpeg)) return 'image/jpeg';
  if (startsWith(bytes, gif87a) || startsWith(bytes, gif89a)) return 'image/gif';
  if (startsWith(bytes, riff) && startsWith(bytes, webp, 8)) return 'image/webp';
  return null;
}
