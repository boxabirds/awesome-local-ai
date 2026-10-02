/**
 * Board addresses: the only thing a person needs in order to join a board.
 *
 * A board id is 16 random bytes written as base64url without padding, which is
 * 22 characters long and safe to put in a URL path. Story 5 introduces board
 * creation; until then a board is reached by its address alone, so the address
 * itself is the only thing keeping a board private (PRD "Security (interim)").
 */

/** Bytes of randomness in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;
/** base64url of 16 bytes, no padding: exactly 22 URL-safe characters. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** The base64url alphabet (RFC 4648 §5), which is also URL-safe unpadded. */
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** True when `id` is a well-formed board address; nothing else is checked. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** A fresh, unguessable board address: 16 random bytes as 22 base64url characters. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let id = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const left = Math.min(3, bytes.length - i);
    // Up to three bytes as a 24-bit number, then four 6-bit groups. Sixteen
    // bytes are five full groups of three plus one, which is 5 * 4 + 2 = 22
    // characters — the base64 `=` padding is never written.
    const chunk = (bytes[i] << 16) | (left > 1 ? bytes[i + 1] << 8 : 0) | (left > 2 ? bytes[i + 2] : 0);
    id += BASE64URL[(chunk >> 18) & 63] + BASE64URL[(chunk >> 12) & 63];
    if (left > 1) id += BASE64URL[(chunk >> 6) & 63];
    if (left > 2) id += BASE64URL[chunk & 63];
  }
  return id;
}
