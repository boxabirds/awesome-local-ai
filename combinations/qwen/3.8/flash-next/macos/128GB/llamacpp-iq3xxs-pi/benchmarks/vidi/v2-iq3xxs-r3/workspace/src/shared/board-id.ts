/**
 * Board addresses (live.isolation): every board is reached by an id that is
 * also the name of its Durable Object, so ids must be hard to guess once
 * story 5 introduces board creation.
 */

/** Random bytes behind a board id (128 bits), hence 22 base64url characters. */
export const BOARD_ID_BYTES = 16;

/** base64url of 16 bytes without padding: `[A-Za-z0-9_-]{22}`. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** base64url alphabet: the 64 standard base64 characters with `+` -> `-` and
/** `/` -> `_`, so an id is safe inside a URL path and a Durable Object name. */
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url without padding: 3 bytes become 4 characters, the tail is rounded up. */
function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let offset = 0; offset < bytes.byteLength; offset += 3) {
    const b0 = bytes[offset] ?? 0;
    const b1 = bytes[offset + 1] ?? 0;
    const b2 = bytes[offset + 2] ?? 0;
    const present = Math.min(3, bytes.byteLength - offset);
    const group = ((b0 << 16) | (b1 << 8) | b2) >>> 0;
    // 1 byte -> 2 characters, 2 -> 3, 3 -> 4.
    for (let i = 0; i < present + 1; i += 1) {
      out += BASE64URL[(group >> (6 * (3 - i))) & 0b111111];
    }
  }
  return out;
}

/**
 * True when `id` is a well-formed board id (never fetches anything). Both sides
 * of the wire ask this before they do anything with an id: the Worker so a
 * malformed link never reaches the namespace (share.not_found), the client so a
 * malformed address is answered locally instead of by a request.
 */
export function isValidBoardId(id: unknown): boolean {
  return typeof id === 'string' && BOARD_ID_PATTERN.test(id);
}

/** A fresh board id: 16 random bytes, base64url encoded without padding. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
