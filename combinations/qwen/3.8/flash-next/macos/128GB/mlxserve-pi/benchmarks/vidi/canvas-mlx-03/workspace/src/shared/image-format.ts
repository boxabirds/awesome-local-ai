// Naming an image by its bytes (story 12).
//
// The Worker cannot afford the client's confidence. A request to upload arrives with a
// claimed content type that whatever wrote the request chose freely, and a filename that
// means nothing; the only thing it can be given that means something is the file's own
// beginning. So this is the whole of the server's type check: the signature each accepted
// format is required to start with, and nothing else.
//
// It is a deliberately small piece of knowledge. Formats are not *recognised* here — no
// dimensions, no validity, no "is this a complete file" — because the server neither needs
// those answers nor can pay for them. What it needs is a content type to store a file under
// that it can hand back with a straight face, and a reason to refuse a file that is not one
// of the four the product accepts.

import { AcceptedImageType, IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config.ts';

/**
 * The leading bytes of each accepted format.
 *
 * PNG's is eight bytes because the format defines all eight as part of the signature,
 * including the two that exist to catch a file that was carried as text. JPEG's is three —
 * start-of-image followed by the first marker — and GIF's is the six-character version
 * string, which is why GIF87a files are accepted and "GIFC" is not. WebP is a RIFF
 * container, so its name is eight bytes in: a RIFF file whose form is not WEBP is a WAV or
 * an AVI, and an image board has no business with either.
 */
export const IMAGE_FORMAT_SIGNATURES: Record<AcceptedImageType, Uint8Array> = {
  'image/png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': new Uint8Array([0xff, 0xd8, 0xff]),
  'image/gif': new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), // GIF87a
  'image/webp': new Uint8Array([0x52, 0x49, 0x46, 0x46]), // RIFF; the form name is checked separately
};

const WEBP_FORM_OFFSET = 8;
const WEBP_FORM = new Uint8Array([0x57, 0x45, 0x42, 0x50]); // WEBP

const GIF_VERSIONS = ['GIF87a', 'GIF89a'];

function startsWith(bytes: Uint8Array, signature: Uint8Array, at = 0): boolean {
  if (bytes.length < at + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[at + i] !== signature[i]) return false;
  }
  return true;
}

/**
 * The image type a file's bytes declare, or null if they declare none of the accepted ones.
 *
 * Only the first IMAGE_SNIFF_BYTES bytes are looked at; a longer buffer is read as if it
 * were that long, so a caller can hand over a whole file or a partial read and get the same
 * answer. The check is the format's own requirement, not a heuristic: an image decoder that
 * was handed these bytes would refuse the file for exactly the same reason.
 */
export function sniffImageType(bytes: Uint8Array): AcceptedImageType | null {
  const head = bytes.length > IMAGE_SNIFF_BYTES ? bytes.subarray(0, IMAGE_SNIFF_BYTES) : bytes;

  if (startsWith(head, IMAGE_FORMAT_SIGNATURES['image/png'])) return 'image/png';

  if (startsWith(head, IMAGE_FORMAT_SIGNATURES['image/jpeg'])) return 'image/jpeg';

  // GIF's signature is a version string, and two versions are in the wild.
  if (head.length >= 6) {
    const version = String.fromCharCode(...head.subarray(0, 6));
    if (GIF_VERSIONS.includes(version)) return 'image/gif';
  }

  if (startsWith(head, IMAGE_FORMAT_SIGNATURES['image/webp'])) {
    if (startsWith(head, WEBP_FORM, WEBP_FORM_OFFSET)) return 'image/webp';
  }

  return null;
}

/** Is this string one of the four content types the board accepts? */
export function isAcceptedImageType(value: unknown): value is AcceptedImageType {
  return typeof value === 'string' && (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(value);
}

/**
 * An asset key: a board id, a slash, an asset id — both 22 characters of the same alphabet
 * board links use, and nothing else.
 *
 * This is what a stored image's address is matched against before it is read, and it is the
 * only thing standing between a guess and a file: an asset id is not in any index, and a key
 * that is not exactly this shape is not even looked for.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** Where a board's images live in the bucket: the board's id, as one prefix. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
