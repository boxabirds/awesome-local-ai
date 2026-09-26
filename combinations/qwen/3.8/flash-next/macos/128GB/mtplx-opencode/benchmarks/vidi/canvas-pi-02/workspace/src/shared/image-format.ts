/**
 * Image format sniffing and asset keys (story 12).
 *
 * A board accepts four raster image types, and it decides that from the
 * *bytes*, not from a file name or a `Content-Type` header: a PDF renamed
 * `.png` is a PDF, and an SVG can carry a script. Everything that has to
 * answer "is this a picture, and where does its stored copy live" is here,
 * shared by the Worker (which sniffs before it stores anything) and the
 * client (which sniffs what a `File` claims to be).
 *
 * The checks read only the first `IMAGE_SNIFF_BYTES` bytes. That is enough
 * for all four signatures, and it is what lets the Worker check a 12 MiB
 * upload without first deciding what is inside all of it.
 */
import { IMAGE_ACCEPTED_TYPES } from './config';

/** The four spellings a type can take here: the MIME strings themselves. */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/** True when the first bytes of `head` are exactly `bytes`. */
function startsWith(head: Uint8Array, bytes: number[]): boolean {
  if (head.length < bytes.length) return false;
  for (let index = 0; index < bytes.length; index += 1) {
    if (head[index] !== bytes[index]) return false;
  }
  return true;
}

/** The six bytes at `offset`, as text — for signatures that spell words. */
function textAt(head: Uint8Array, offset: number, length: number): string {
  if (head.length < offset + length) return '';
  let text = '';
  for (let index = offset; index < offset + length; index += 1) {
    text += String.fromCharCode(head[index] as number);
  }
  return text;
}

/**
 * Which accepted image type these bytes begin with, or `null` for anything
 * else — including anything that merely *looks* close: a `RIFF` container
 * that does not say `WEBP` is a WAV, and the board does not host WAVs.
 *
 * JPEG is `FF D8 FF`; the third byte matters because a file that starts
 * `FF D8` and then diverges is a truncated JPEG, which is exactly the class
 * of file this check exists to refuse.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  const magic = textAt(head, 0, 6);
  if (magic === 'GIF87a' || magic === 'GIF89a') return 'image/gif';
  // A WebP is a RIFF container whose form type is `WEBP`: four bytes, a
  // four-byte size, then the form type. Checking only `RIFF` would accept
  // every Audio IFF ever written.
  if (textAt(head, 0, 4) === 'RIFF' && textAt(head, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/** Is this declared type one the board hosts? A name is not a type; content is. */
export function isAcceptedImageType(type: string): boolean {
  return (IMAGE_ACCEPTED_TYPES as readonly string[]).includes(type);
}

/**
 * What a stored asset's key looks like: `<boardId>/<assetId>`, both halves
 * made by `newBoardId()` or `newAssetId()` (22 base64url characters).
 *
 * The pattern is the whole of the serving contract: a key that does not
 * match it is refused without ever reaching the bucket, which is what makes
 * `../` and a guessed prefix a `404` rather than a read. Both halves have to
 * be full-length ids — a short one is a truncated paste, not a picture.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A fresh asset id: 22 base64url characters, 6 bits of randomness each
 * (132 bits in total), taken from the platform's random source.
 *
 * Keys are made by whoever holds the bytes — that is what lets a browser
 * name its own asset and a Worker check the name against the pattern without
 * ever having to trust the caller. A guessed key is 132 bits of guessing.
 */
export function newAssetId(rand: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(22);
  rand(bytes);
  let key = '';
  for (const byte of bytes) key += BASE64URL[byte & 0x3f] as string;
  return key;
}

/** The key an asset uploaded to `boardId` under `assetId` is stored under. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}
