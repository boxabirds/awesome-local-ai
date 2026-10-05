/**
 * What an upload actually is, and what a storage key is allowed to look like (story 12).
 *
 * Both halves of this file exist because the board cannot believe what it is told. A browser says a file is
 * `image/png` because of its extension; the server that stores it can read a dozen bytes instead, and a dozen
 * bytes is the only account of itself a file cannot get wrong. The same goes for keys: the serving route is
 * public, so the shape of a key is the only thing standing between a stranger and every picture on every
 * board, and a shape that lets `..` through lets everything through.
 */

import { IMAGE_SNIFF_BYTES, type AcceptedImageType } from './config';

/** A signature: a type, and the byte runs that say it, each at a fixed place in the file's first bytes. */
export interface ImageMagic {
  readonly type: AcceptedImageType;
  readonly parts: ReadonlyArray<{ readonly offset: number; readonly bytes: readonly number[] }>;
}

/**
 * The bytes that say what a file is.
 *
 * Twelve is all any of the four needs: a PNG is eight bytes, a JPEG three, a GIF six, and a WebP is `RIFF`, a
 * four byte length nobody reads, and `WEBP`. A WAV file starts with the same `RIFF` as a WebP does, which is
 * why WebP's signature is two runs and not one.
 */
export const IMAGE_MAGIC: readonly ImageMagic[] = [
  { type: 'image/png', parts: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] }] },
  { type: 'image/jpeg', parts: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }] },
  { type: 'image/gif', parts: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61] }] }, // GIF87a
  { type: 'image/gif', parts: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61] }] }, // GIF89a
  {
    type: 'image/webp',
    parts: [
      { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }, // RIFF
      { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] }, // WEBP
    ],
  },
];

/** The bytes the board looks at: no more than the longest signature, and no less. */
function firstBytes(head: Uint8Array): Uint8Array {
  return head.byteLength > IMAGE_SNIFF_BYTES ? head.subarray(0, IMAGE_SNIFF_BYTES) : head;
}

function startsWith(haystack: Uint8Array, bytes: readonly number[], offset: number): boolean {
  if (offset + bytes.length > haystack.length) return false;
  for (let index = 0; index < bytes.length; index++) {
    if (haystack[offset + index] !== bytes[index]) return false;
  }
  return true;
}

/**
 * Which of the four accepted image types these bytes are, or `null` for anything else.
 *
 * Only the first `IMAGE_SNIFF_BYTES` bytes are consulted. A PDF, a ZIP, an ELF binary, an SVG and a file that
 * stops halfway through its own magic number all get the same answer, which is no answer.
 *
 * This is the server's rule. The browser checks a `File.type` as a courtesy before it uploads anything; this
 * is what the board actually goes by.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  const bytes = firstBytes(head);
  for (const magic of IMAGE_MAGIC) {
    if (magic.parts.every((part) => startsWith(bytes, part.bytes, part.offset))) return magic.type;
  }
  return null;
}

/**
 * What a storage key looks like: `<board id>/<asset id>`, both 22 characters from the generator story 5 uses
 * (`newBoardId`), which is 128 bits of randomness each.
 *
 * That is the whole of the serving route's authorisation. There is no signed URL and no session, so the only
 * thing a stranger has to guess is a key that cannot be guessed, and anything that is not exactly this shape —
 * a `..`, an escaped slash, a short segment, nothing at all — is not a key and is answered with a 404 in the
 * same fraction of a second as one that was never uploaded. Checking the shape first also means a request
 * that is obviously not for a picture never costs an R2 read.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** A 22 character id as the board's own generator emits them. */
export const ASSET_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * Where a picture for this asset of this board is kept.
 *
 * Throws on an id that is not one of the board's own, because the alternative is writing an object that the
 * serving route can never hand back: a key that does not match its own pattern is a bug rather than a bad
 * request, and it should say so where it happens rather than four layers away.
 */
export function assetKeyFor(boardId: string, assetId: string): string {
  if (!ASSET_KEY_ID_PATTERN.test(boardId)) throw new Error(`not a board id: ${JSON.stringify(boardId)}`);
  if (!ASSET_KEY_ID_PATTERN.test(assetId)) throw new Error(`not an asset id: ${JSON.stringify(assetId)}`);
  return `${boardId}/${assetId}`;
}
