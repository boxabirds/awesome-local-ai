import { IMAGE_ACCEPTED_TYPES } from './config';

/**
 * Identifying an image by what it *contains*.
 *
 * A file's name and its `File.type` are both claims the sender makes, and both are wrong by
 * accident constantly — a PDF renamed to `.png` uploads as `image/png`. This endpoint stores
 * bytes and serves them back with a `Content-Type` of its choosing, so whose claim decides
 * matters: if the sender's did, then one signed HTML page would be enough to be told which
 * images a board contains, and one stored HTML file served from the board's own origin would
 * be a script that runs there. The bytes decide, and anything that cannot be identified is
 * never stored at all (spec: image-types.security).
 */

/** One of the kinds of image this board accepts, named the way a MIME type names it. */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** Every byte of a `Uint8Array` compared against a fixed prefix, when there are that many. */
function startsWith(bytes: Uint8Array, at: number, prefix: readonly number[]): boolean {
  if (at + prefix.length > bytes.length) return false;
  return prefix.every((byte, index) => bytes[at + index] === byte);
}

/** PNG's 8-byte signature, `‹PNG›` then DOS line endings, which catches a CRLF-mangled file. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/*
 * PNG's first chunk is always `IHDR`, the one that states the image's size and depth, and
 * its data is always 13 bytes. The chunk's four-byte length is therefore readable at bytes
 * 8-11 — inside the sniff window, where the four bytes that spell `IHDR` are not.
 */
const PNG_IHDR_DATA_BYTES = 13;
/** JPEG starts with the Start-Of-Image marker followed by the start of a frame or segment. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
/** The two GIF magic numbers: a GIF87a is the same kind of file, so both are accepted. */
const GIF87A = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
/** WebP is a RIFF container whose kind field says `WEBP`, eight bytes past `RIFF`. */
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/**
 * Identify an image from the front of the file, or `null` when those bytes are not an image
 * this board serves. `head` is the first `IMAGE_SNIFF_BYTES` bytes of the upload.
 *
 * A signature is a claim too, so each kind is checked as far as its own format requires: a
 * PNG must go on to declare the fixed-size header chunk that describes its pixels, a WebP
 * must be a RIFF container *of type WebP* rather than of type `WAVE`, and a JPEG's three
 * bytes are already as specific as its format gets. That is what makes a file that merely
 * begins like an image — a PNG truncated or zeroed after its signature — an ordinary
 * rejection instead of a stored file nothing can display.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, 0, PNG_SIGNATURE)) {
    // The signature is 8 bytes; the next 4 are the length of the chunk that follows.
    if (head.length < 12) return null;
    const firstChunk = (head[8] << 24) | (head[9] << 16) | (head[10] << 8) | head[11];
    return firstChunk === PNG_IHDR_DATA_BYTES ? 'image/png' : null;
  }
  if (startsWith(head, 0, JPEG_SIGNATURE)) return 'image/jpeg';
  if (startsWith(head, 0, GIF87A) || startsWith(head, 0, GIF89A)) return 'image/gif';
  if (startsWith(head, 0, RIFF) && startsWith(head, 8, WEBP)) return 'image/webp';
  return null;
}

/**
 * A key in R2's object name space: `<boardId>/<assetId>`, both from `newBoardId()`, so both
 * 22 characters of base64url and neither guessable. The pattern is the allow-list the serving
 * route reads its key out of the URL with — anything it rejects never becomes a bucket lookup
 * — and it allows exactly one `/`, so `..` cannot appear in a key at all, let alone `../`.
 */
export const ASSET_KEY_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** One half of a key, checked before it is joined to the other. */
const KEY_PART_PATTERN: RegExp = /^[A-Za-z0-9_-]{22}$/;

/**
 * The R2 key an asset lives at. It throws rather than building a key from ids that are not
 * ids: the caller has already checked the board id against the same pattern, so arriving here
 * with something else is a bug in the caller, and a key that cannot be served would be found
 * much later — as a missing image on somebody's board.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  if (!KEY_PART_PATTERN.test(boardId) || !KEY_PART_PATTERN.test(assetId)) {
    throw new Error('assetKeyFor: both parts of an asset key must be 22 base64url characters');
  }
  return `${boardId}/${assetId}`;
}

/** The key of `asset`, or null if `asset` is not a key. For a URL path segment. */
export function isAssetKey(key: string): boolean {
  return ASSET_KEY_PATTERN.test(key);
}
