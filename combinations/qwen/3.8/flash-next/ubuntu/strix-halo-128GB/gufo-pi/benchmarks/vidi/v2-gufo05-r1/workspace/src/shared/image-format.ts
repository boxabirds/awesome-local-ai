/**
 * What an image is, decided from bytes.
 *
 * A board accepts four raster image types, and it decides that from the file's own content
 * and from nothing else (`image.types`): a name ending in `.png` and a `Content-Type` of
 * `image/png` are both things a client — or an attacker — can write freely, and an SVG is
 * markup that could run when the board later shows it. So the Worker looks at the first
 * `IMAGE_SNIFF_BYTES` of the body, and the browser's file name never reaches that decision.
 *
 * The signatures are the whole magic-byte story of the four formats:
 *
 * | type          | bytes                                                     |
 * |---------------|-----------------------------------------------------------|
 * | PNG           | `89 50 4E 47`                                             |
 * | JPEG          | `FF D8 FF`                                                |
 * | GIF           | `GIF87a` or `GIF89a`                                      |
 * | WebP          | `RIFF`, four ignored bytes, `WEBP`                        |
 *
 * Anything else — a PDF renamed to `.png`, an SVG, three random bytes — is not an image as
 * far as the board is concerned, and is refused before a single byte is stored.
 */
import type { AcceptedImageType } from './config';

export type { AcceptedImageType };

/** `89 50 4E 47` — "\x89PNG". */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];
/** `FF D8 FF` — the JPEG start-of-image marker, always followed by a marker of its own. */
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
/** `GIF87a` and `GIF89a`, which differ in one byte and are the same thing to a sniffer. */
const GIF_VERSIONS = ['GIF87a', 'GIF89a'];
/** `RIFF` and `WEBP`, the second four bytes after it. */
const RIFF_TAG = 'RIFF';
const WEBP_TAG = 'WEBP';

/** Exactly `<board id>/<asset id>`, both 22 characters of base64url (`newBoardId`).
 *
 * Anchored, so nothing else is a key: `../x` and a 23-character id are not addresses of
 * stored objects, and a request that carries one is answered as if no board had one.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** The R2 key an asset of this board is stored under. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** The path one stored picture is served from. Client and Worker agree on this one string. */
export const ASSET_ROUTE = '/api/assets';

/**
 * The URL a browser is pointed at to fetch a stored picture.
 *
 * Relative, because the board and its assets are one origin: that is what lets the response
 * be cached forever under a key that can never be reused (`assets.api`).
 */
export function assetUrl(assetKey: string): string {
  return `${ASSET_ROUTE}/${assetKey}`;
}

/** Does `head` start with these exact bytes? */
function startsWith(head: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((byte, index) => head[index] === byte);
}

/** The four characters at `offset`, as text. */
function ascii(head: Uint8Array, offset: number, length: number): string {
  if (head.length < offset + length) return '';
  let out = '';
  for (let index = offset; index < offset + length; index += 1) {
    out += String.fromCharCode(head[index] as number);
  }
  return out;
}

/** The accepted type these bytes are, or `null` when they are not an accepted image. */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, PNG_SIGNATURE)) return 'image/png';
  if (startsWith(head, JPEG_SIGNATURE)) return 'image/jpeg';
  const magic = ascii(head, 0, 6);
  if (GIF_VERSIONS.includes(magic)) return 'image/gif';
  // A WebP is a RIFF container whose form tag is four bytes past the length. Both halves
  // have to be there: "RIFF" on its own is a WAVE file as much as a picture.
  if (ascii(head, 0, 4) === RIFF_TAG && ascii(head, 8, 4) === WEBP_TAG) return 'image/webp';
  return null;
}
