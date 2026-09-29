// The image format sniffer and the asset-key shape (story 12, assets.api).
//
// The type of an uploaded image is decided ONLY from its content, never from the
// `Content-Type` a client sent (image.types): the sniff reads the first
// IMAGE_SNIFF_BYTES bytes and matches a magic-number signature. A file renamed
// from a PDF, an SVG that could carry a script, or three random bytes are all
// `null` here - and `null` is what the upload handler turns into a 415 before
// anything is written to storage.
//
// An asset key is `<boardId>/<assetId>`, both 22-character base64url ids from
// story 5's `newBoardId()` (128 bits), so a stored image's address is as hard to
// guess as a board's own link (PRD security). `ASSET_KEY_PATTERN` is the shape the
// serving route checks BEFORE it touches R2, so a `../` probe or a wrong-length
// id is a 404 that names nothing.

import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config.ts';

/** The image types the sniffer can name - exactly the accepted product types. */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** True when `head` starts at `offset` with `sig`. Reads defensively. */
function startsWith(head: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (head.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) {
    if (head[offset + i] !== sig[i]) return false;
  }
  return true;
}

// The magic numbers, spelled as bytes rather than strings so the comparison is
// byte-exact and independent of any encoding.
const PNG = [0x89, 0x50, 0x4e, 0x47]; // 0x89 "PNG"
const JPEG = [0xff, 0xd8, 0xff];
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]; // "GIF87a"
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]; // "GIF89a"
const RIFF = [0x52, 0x49, 0x46, 0x46]; // "RIFF"
const WEBP = [0x57, 0x45, 0x42, 0x50]; // "WEBP" at byte 8

/**
 * The image type a file's first bytes claim, or null when they claim nothing the
 * board accepts. Only the leading IMAGE_SNIFF_BYTES are ever looked at - so a
 * signature that needs twelve bytes (RIFF....WEBP) is checked, and a longer one
 * would need the setting raised with it.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (!(head instanceof Uint8Array)) return null;
  // Only ever consider the sniffing window, so an over-long head cannot match on
  // a signature past IMAGE_SNIFF_BYTES.
  const window = head.length > IMAGE_SNIFF_BYTES ? head.subarray(0, IMAGE_SNIFF_BYTES) : head;
  if (startsWith(window, PNG)) return 'image/png';
  if (startsWith(window, JPEG)) return 'image/jpeg';
  if (startsWith(window, GIF87A) || startsWith(window, GIF89A)) return 'image/gif';
  // WebP is RIFF at 0 and WEBP at 8, with the four file-length bytes between them
  // (never matched, always present in a real WebP).
  if (startsWith(window, RIFF, 0) && startsWith(window, WEBP, 8)) return 'image/webp';
  return null;
}

/**
 * The shape of a served asset key: a valid board id, a slash, and a valid asset
 * id - both 22 base64url characters, the same alphabet as story 5's board codes.
 * Anything else (a missing half, a `..`, an over- or under-long part) is false,
 * which the serving route answers as 404 without reading storage.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** `assetKeyFor` composes the served key from the two ids; it validates nothing. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** Whether a composed key has the served shape (a guard for callers/tests). */
export function isAssetKey(key: string): boolean {
  return ASSET_KEY_PATTERN.test(key);
}
