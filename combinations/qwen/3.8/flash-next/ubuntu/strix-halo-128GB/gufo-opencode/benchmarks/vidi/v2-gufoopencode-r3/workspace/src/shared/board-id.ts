// Board addresses: 16 random bytes rendered as base64url without padding
// (22 characters). Story 5 introduces board creation; until then a board is
// reached by its address and ids are generated client-side.
export const BOARD_ID_BYTES = 16;
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

// 16 random bytes -> base64url without padding (22 chars).
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let out = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      out += BASE64URL_ALPHABET[(value >>> (bits - 6)) & 63];
      bits -= 6;
    }
  }
  if (bits > 0) {
    out += BASE64URL_ALPHABET[(value << (6 - bits)) & 63];
  }
  return out;
}
