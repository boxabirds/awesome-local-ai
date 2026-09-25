/**
 * Board identifiers (story 3).
 *
 * A board id is 16 random bytes (128 bits) encoded as unpadded base64url:
 * exactly 22 characters from `[A-Za-z0-9_-]`. The pattern is deliberately
 * strict: it is the Worker's only gate before a request may address a
 * Durable Object, so it must also reject traversal (`../`) and URL
 * characters that would change the route.
 */

/** Number of random bytes backing one board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** Exact shape of a board id: base64url of 16 bytes, no padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id (see BOARD_ID_PATTERN). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Generate a fresh board id (16 random bytes -> base64url, no padding). */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  // 16 bytes = five 3-byte groups (20 chars) plus one remaining byte
  // (2 chars, no padding) = 22 chars total.
  let id = '';
  for (let i = 0; i < BOARD_ID_BYTES; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < BOARD_ID_BYTES ? bytes[i + 1] : 0;
    const b2 = i + 2 < BOARD_ID_BYTES ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    id +=
      BASE64URL_ALPHABET[(n >> 18) & 0x3f] +
      BASE64URL_ALPHABET[(n >> 12) & 0x3f] +
      BASE64URL_ALPHABET[(n >> 6) & 0x3f] +
      BASE64URL_ALPHABET[n & 0x3f];
  }
  return id.slice(0, 22);
}
