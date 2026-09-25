/**
 * Board ids: 16 random bytes, base64url without padding (22 characters). Shared by the Worker
 * (validation before any Durable Object is touched) and the client (new board addresses).
 */

/** 128 bits of randomness. */
export const BOARD_ID_BYTES = 16;
/** base64url of BOARD_ID_BYTES bytes, no padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BITS_PER_BYTE = 8;
const BITS_PER_CHAR = 6;
const CHAR_MASK = 0b111111;

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** A new, hard-to-guess board id: BOARD_ID_BYTES from crypto.getRandomValues as base64url. */
export function newBoardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BOARD_ID_BYTES));
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << BITS_PER_BYTE) | byte;
    bits += BITS_PER_BYTE;
    while (bits >= BITS_PER_CHAR) {
      bits -= BITS_PER_CHAR;
      out += BASE64URL[(buffer >> bits) & CHAR_MASK];
    }
    buffer &= (1 << bits) - 1;
  }
  // Remaining bits, left-aligned in one last character (no padding).
  if (bits > 0) out += BASE64URL[(buffer << (BITS_PER_CHAR - bits)) & CHAR_MASK];
  return out;
}
