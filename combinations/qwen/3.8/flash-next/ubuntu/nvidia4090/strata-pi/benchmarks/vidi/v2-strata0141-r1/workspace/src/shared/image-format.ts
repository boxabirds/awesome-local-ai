import { BOARD_ID_PATTERN, isValidBoardId } from './board-id';
import { ASSET_CACHE_MAX_AGE_SECONDS, IMAGE_SNIFF_BYTES } from './config';

/**
 * What an image asset *is* (anchor `assets.api`), as pure functions with no
 * storage and no HTTP, so both sides of the upload check the same rules.
 *
 * Two rules live here:
 *
 * 1. **Type by sniffing.** The accepted set is `IMAGE_ACCEPTED_TYPES` - PNG,
 *    JPEG, GIF and WebP, all raster - and a file belongs to it only if its first
 *    bytes say so. A filename, an extension and the MIME type a browser puts on
 *    a `File` are all claims; the magic numbers are the fact. `sniffImageType`
 *    is called with the front of the upload and answers the format or `null`.
 *    SVG is refused on purpose: it is a document that can carry a script, and a
 *    board that serves board-owned documents inline is a board that runs them
 *    (`image.types`, PRD security).
 * 2. **Asset keys.** An asset is addressed by `<boardId>/<assetId>` where the
 *    asset half is a fresh random id. The board half is validated with
 *    `isValidBoardId` from `src/shared/board-id.ts`, so the storage prefix a
 *    board owns is part of the key itself and no listing can cross it. A key is
 *    never rewritten, which is what lets the served response be cached for a
 *    year (`ASSET_CACHE_MAX_AGE_SECONDS`, `image.immutable`).
 */

/** One of the accepted image formats, named by what the sniff found. */
export type AcceptedImageType = 'png' | 'jpeg' | 'gif' | 'webp';

/**
 * The MIME type each sniffed format is stored and served as.
 *
 * The keys are the formats `sniffImageType` can answer with; the values are
 * exactly `IMAGE_ACCEPTED_TYPES`, which is asserted in the unit tests so the
 * picker's `accept` list and what storage will accept cannot drift apart.
 */
export const ACCEPTED_CONTENT_TYPES: Record<AcceptedImageType, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const ACCEPTED_FORMATS = new Set<string>(Object.keys(ACCEPTED_CONTENT_TYPES));

/** Is `value` one of the accepted formats? */
export function isAcceptedImageType(value: unknown): value is AcceptedImageType {
  return typeof value === 'string' && ACCEPTED_FORMATS.has(value);
}

/** The MIME type of an accepted format, `null` for anything else. */
export function contentTypeOf(type: string): string | null {
  return isAcceptedImageType(type) ? ACCEPTED_CONTENT_TYPES[type] : null;
}

/** How a stored asset is cached: a key is written once and never changes. */
export function cacheControlForAsset(): string {
  return `public, max-age=${ASSET_CACHE_MAX_AGE_SECONDS}, immutable`;
}

/* ------------------------------------------------------------------ sniffing */

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_MAGICS = ['GIF87a', 'GIF89a'];

const hasByte = (head: Uint8Array, index: number): boolean => index < head.length;

const startsWithBytes = (head: Uint8Array, magic: readonly number[]): boolean =>
  head.length >= magic.length && magic.every((byte, index) => head[index] === byte);

/** `length` bytes of the head read as ASCII, for the formats named in text. */
const ascii = (head: Uint8Array, length: number): string =>
  Array.from(head.subarray(0, length), (byte) => String.fromCharCode(byte)).join('');

/**
 * Which accepted format these bytes are, or `null` for anything else (TC-01).
 *
 * Fewer bytes than `IMAGE_SNIFF_BYTES` answer `null` rather than guessing from a
 * partial header: 8 bytes are enough for a PNG magic number in principle, but a
 * head that short means a file that is being truncated on the way in, and a
 * truncated image is not something to store.
 */
export function sniffImageType(head: Uint8Array): AcceptedImageType | null {
  if (!(head instanceof Uint8Array) || head.length < IMAGE_SNIFF_BYTES) {
    return null;
  }
  // Everything accepted is raster: no format here is identified by text, and a
  // head that matches nothing accepted is refused whatever it claims to be.
  if (startsWithBytes(head, PNG_MAGIC)) {
    return 'png';
  }
  // JPEG: SOI (`FF D8`) followed by the marker that always starts a JFIF stream.
  if (hasByte(head, 2) && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
    return 'jpeg';
  }
  if (GIF_MAGICS.includes(ascii(head, 6))) {
    return 'gif';
  }
  if (ascii(head, 4) === 'RIFF' && ascii(head.subarray(8), 4) === 'WEBP') {
    return 'webp';
  }
  return null;
}

/* ------------------------------------------------------------------ asset keys */

/** The asset half of a key: a fresh random id, 22 characters, URL-safe. */
export const ASSET_ID_BYTES = 16;
export const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

/**
 * A whole asset key: the board's own address, a slash, the asset id.
 *
 * Exactly two segments, both from the URL-safe alphabet, both at their allowed
 * lengths (`TC-02`). Nothing else - not `..`, not an extra segment, not a
 * percent-encoded slash - is a key, so a key taken out of a URL can be handed
 * straight to storage. The board half is `BOARD_ID_PATTERN` itself, anchors
 * stripped, so the prefix a board owns is part of what a key has to be.
 */
const boardHalfOfKey = BOARD_ID_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '');
const assetHalfOfKey = ASSET_ID_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '');
export const ASSET_KEY_PATTERN = new RegExp(`^${boardHalfOfKey}/${assetHalfOfKey}$`);

/** base64url (no padding) of the given bytes. */
function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh asset id: the same generator board addresses use. */
export function newAssetId(): string {
  const bytes = new Uint8Array(ASSET_ID_BYTES);
  const crypto = (globalThis as { crypto?: Crypto }).crypto;
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return base64Url(bytes);
}

/**
 * The key an upload of this board's asset gets (`TC-02`).
 *
 * A malformed board id or asset id returns `null` instead of building a key out
 * of it: `brd/..`, `brd/a/b` and `/a` never become keys at all. With no asset id
 * given, one is generated - randomly per call, so the same key can only appear
 * twice by chance, which is why the asset API treats a repeated key as corrupt
 * storage rather than as an upload.
 */
export function assetKeyFor(boardId: string, assetId?: string): string | null {
  if (!isValidBoardId(boardId)) {
    return null;
  }
  const id = assetId ?? newAssetId();
  if (typeof id !== 'string' || !ASSET_ID_PATTERN.test(id)) {
    return null;
  }
  return `${boardId}/${id}`;
}

/** Is `key` a well-formed asset key? */
export function isAssetKey(key: unknown): key is string {
  return typeof key === 'string' && ASSET_KEY_PATTERN.test(key);
}

/**
 * The key a request path asks for (`TC-02`), or `null` when the path asks for
 * something that is not a key: `/api/assets/`, `/api/assets/<board>`,
 * `/api/assets/a/b`.
 */
export function assetKeyOfPath(path: string): string | null {
  if (typeof path !== 'string') {
    return null;
  }
  const withoutPrefix = path.startsWith('/api/assets/') ? path.slice('/api/assets/'.length) : path;
  return isAssetKey(withoutPrefix) ? withoutPrefix : null;
}
