/**
 * What an image file *is*, judged by its bytes (`src/shared/image-format.ts`,
 * story 12).
 *
 * This module is the answer to one question, asked in two places: "may this file
 * become a board image?" The browser asks it first, of the type the file claims to
 * have (`validateFiles`), because that is free and catches the ordinary case; the
 * Worker asks it of the bytes themselves, because a claim is not evidence. A PDF
 * renamed `holiday.png` arrives with `file.type === 'image/png'` and a
 * `Content-Type: image/png` header - only its first four bytes know it is a PDF -
 * and an SVG can carry a `<script>` that runs on the origin that serves it.
 *
 * So the decision is made from the signature and nothing else: PNG, JPEG, GIF and
 * WebP have one, and everything else is refused. The four signatures are the whole
 * of what this file knows about images; there is no decoder in here and there must
 * never be one, because the Worker and the browser both import it.
 *
 * Framework-free and DOM-free: `src/worker/assets.ts` imports this, and a Worker may
 * not reach for a browser API.
 */

import { IMAGE_ACCEPTED_TYPES, IMAGE_SNIFF_BYTES } from './config.js';

/** One of the four types the board accepts, by MIME type (`IMAGE_ACCEPTED_TYPES`). */
export type AcceptedImageType = (typeof IMAGE_ACCEPTED_TYPES)[number];

/**
 * A key is a board id, a slash and an asset id - both 22 base64url characters, both
 * 128 bits of randomness (`newBoardId`).
 *
 * The pattern is checked before the key is used for anything, on both sides: it is
 * what makes `/api/assets/../../etc/passwd` a 404 rather than a lookup, and it is
 * what means an asset path can never name another board's file, because the first
 * half of the key is the board and the board has already been checked.
 */
export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{22}\/[A-Za-z0-9_-]{22}$/;

/** One board's id, one slash, one asset id. No validation here: the caller's job. */
export function assetKeyFor(boardId: string, assetId: string): string {
  return `${boardId}/${assetId}`;
}

/** Is this a well-formed asset key? */
export const isAssetKey = (key: unknown): key is string =>
  typeof key === 'string' && ASSET_KEY_PATTERN.test(key);

/** Where an asset is read from, given its key (`GET /api/assets/:boardId/:assetId`). */
export const assetPathFor = (key: string): string => `/api/assets/${key}`;

/** Where a file for this board is uploaded to (`POST /api/boards/:id/assets`). */
export const assetUploadPathFor = (boardId: string): string =>
  `/api/boards/${encodeURIComponent(boardId)}/assets`;

/** The prefix of the serving route, and everything after it is the key. */
export const ASSET_ROUTE_PREFIX = '/api/assets/';

/** The signature of PNG: `89 50 4E 47` (the first half of `\x89PNG`). */
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
/** The signature of JPEG: `FF D8 FF` (SOI plus the first byte of a marker). */
const JPEG_MAGIC = [0xff, 0xd8, 0xff];
/** The signatures of the two GIF versions: `GIF87a` and `GIF89a`. */
const GIF87A_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89A_MAGIC = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
/** The two halves of a WebP: `RIFF` at 0 and `WEBP` at 8, with a length between. */
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50];

const bytesMatch = (
  head: ArrayLike<number>,
  magic: readonly number[],
  at = 0,
): boolean => {
  for (let index = 0; index < magic.length; index += 1) {
    if ((head[at + index] as number) !== magic[index]) return false;
  }
  return true;
};

/**
 * Which accepted image type these bytes are, or `null` for anything else.
 *
 * The first {@link IMAGE_SNIFF_BYTES} bytes are enough for all four signatures, and
 * that is the whole test: no container is parsed, no dimension is read, no decoder
 * is asked. A JPEG's full header says a great deal more about it - but nothing the
 * decision needs, and a parser is a place to be wrong about a file that has not yet
 * been accepted.
 *
 * So: PNG (`89504E47`), JPEG (`FFD8FF`), GIF (`GIF87a`/`GIF89a`) and WebP
 * (`RIFF....WEBP`). An SVG is `<svg` or `<?xml`, a PDF is `%PDF`, a HEIC is `ftyp`
 * at byte 4 and a video is something else again; all of them are `null`, which the
 * Worker turns into a 415 and the client into a message.
 *
 * Fewer bytes than a signature needs are not that signature: three bytes that
 * happen to start `FF D8` are not a JPEG we can serve, because the fourth byte is
 * the one that says which marker follows.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (head === null || head === undefined || head.length === 0) return null;
  if (bytesMatch(head, PNG_MAGIC)) return 'image/png';
  if (bytesMatch(head, JPEG_MAGIC)) return 'image/jpeg';
  if (bytesMatch(head, GIF87A_MAGIC) || bytesMatch(head, GIF89A_MAGIC)) return 'image/gif';
  // A WebP is a RIFF container whose four-byte type field says WEBP; the four bytes
  // in between are the container's length, which is why IMAGE_SNIFF_BYTES is 12.
  if (head.length >= IMAGE_SNIFF_BYTES && bytesMatch(head, RIFF_MAGIC) && bytesMatch(head, WEBP_MAGIC, 8)) {
    return 'image/webp';
  }
  return null;
}
