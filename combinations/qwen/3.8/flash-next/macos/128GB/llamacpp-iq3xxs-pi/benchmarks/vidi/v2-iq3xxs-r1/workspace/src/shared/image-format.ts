import { BOARD_ID_PATTERN } from './board-id';
import { IMAGE_ACCEPTED_TYPES } from './config';

/**
 * What an uploaded file *is*, and where it lives.
 *
 * A board accepts four image formats and no others, and the only evidence a server
 * is allowed to use is the first few bytes of the body: a file name and a
 * `Content-Type` are both written by whoever is uploading, so neither is a fact
 * about the file (PRD image.types). The same reasoning gives an asset its key —
 * two unguessable ids, so knowing one board's address never helps you read another
 * board's images (PRD share.unguessable).
 */

/** One of the formats the product adds; the string is also the stored `Content-Type`. */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** PNG: the 8-byte signature from the format's own first chunk. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** JPEG: the start-of-image marker, which every JPEG file begins with. */
const JPEG_START = [0xff, 0xd8, 0xff];
/** GIF: the version string is the whole header, and two versions are in the wild. */
const GIF_HEADERS = ['GIF87a', 'GIF89a'];
/** WebP: a RIFF container whose form type sits at byte 8, four bytes past the size. */
const RIFF = 'RIFF';
const WEBP_FORM = 'WEBP';
const WEBP_FORM_AT = 8;

function hasBytes(head: Uint8Array, bytes: readonly number[], at = 0): boolean {
  if (head.length < at + bytes.length) return false;
  return bytes.every((byte, i) => head[at + i] === byte);
}

function hasText(head: Uint8Array, text: string, at = 0): boolean {
  if (head.length < at + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (head[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * The format a body starts with, or `null` when that body is not one of the four.
 *
 * Only the first `IMAGE_SNIFF_BYTES` bytes are read, which is all a signature needs
 * and everything a caller is asked to keep in memory for a header. A WebP's form
 * type is byte 12, so a shorter head is not a WebP *yet* — that is `null`, not a
 * guess, and a caller that has more bytes simply passes them.
 *
 * Everything else is `null` by construction, including the two that are most often
 * tried: a document renamed to `.png` (its bytes still say `%PDF`) and an SVG (text,
 * and text that can carry a script).
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (!(head instanceof Uint8Array) || head.length === 0) return null;
  if (hasBytes(head, PNG_SIGNATURE)) return 'image/png';
  if (hasBytes(head, JPEG_START)) return 'image/jpeg';
  for (const header of GIF_HEADERS) if (hasText(head, header)) return 'image/gif';
  if (hasText(head, RIFF) && hasText(head, WEBP_FORM, WEBP_FORM_AT)) return 'image/webp';
  return null;
}

/**
 * Exactly `<board id>/<asset id>`, both halves an unpadded base64url board id.
 *
 * This is the whole of the asset namespace: it is what a key lookup is allowed to
 * ask for, so `../`, an extra path segment, or a longer id can never reach storage.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** True when `key` is a well-formed asset address (nothing else is checked). */
export function isAssetKey(key: string): boolean {
  return ASSET_KEY_PATTERN.test(key);
}

/**
 * Where an upload for `boardId` will be written.
 *
 * Both halves have to be board-shaped ids — an asset inherits its board's address
 * rather than being told what it is, which is what keeps a key unguessable and
 * makes a stored image readable only through the board it belongs to.
 *
 * @throws when either half is not a board id.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  if (!BOARD_ID_PATTERN.test(boardId)) throw new Error(`not a board id: ${boardId}`);
  if (!BOARD_ID_PATTERN.test(assetId)) throw new Error(`not an asset id: ${assetId}`);
  return `${boardId}/${assetId}`;
}
