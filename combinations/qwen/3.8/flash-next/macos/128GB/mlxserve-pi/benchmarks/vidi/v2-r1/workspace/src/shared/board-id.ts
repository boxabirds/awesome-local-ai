/**
 * Board addresses. A board id is the whole identity of a board: people who
 * know it are on that board, people who do not cannot reach it. Story 5
 * introduces board creation and share links; until then a board is reached by
 * typing its address (see App routing) and the Worker rejects anything that is
 * not a well-formed id so a wrong address cannot silently create a room.
 */

/** Random bytes behind a board id (128 bits), hence hard to guess. */
export const BOARD_ID_BYTES = 16;

/**
 * A board id is base64url of BOARD_ID_BYTES with the padding removed: 16 bytes
 * are ceil(16/3)*4 = 24 base64 characters minus the 2 `=` of padding = 22.
 */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is exactly a board id this product can serve. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** Base64url alphabet: '-' and '_' instead of '+' and '/', no padding. */
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A fresh, unguessable board id: BOARD_ID_BYTES random bytes encoded as
 * base64url without padding (16 bytes -> 22 characters). Written by hand rather
 * than with `btoa` so it behaves identically in the browser, in workerd and in
 * tests, and can never emit '+' , '/' or '='.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const remaining = bytes.length - i;
    const b0 = bytes[i];
    const b1 = remaining > 1 ? bytes[i + 1] : 0;
    const b2 = remaining > 2 ? bytes[i + 2] : 0;
    id += BASE64URL[b0 >> 2];
    id += BASE64URL[((b0 & 0b11) << 4) | (b1 >> 4)];
    if (remaining > 1) id += BASE64URL[((b1 & 0b1111) << 2) | (b2 >> 6)];
    if (remaining > 2) id += BASE64URL[b2 & 0b111111];
  }
  return id;
}
