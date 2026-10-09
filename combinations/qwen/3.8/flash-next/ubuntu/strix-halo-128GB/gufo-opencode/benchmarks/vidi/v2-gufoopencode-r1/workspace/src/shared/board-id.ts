// Board addresses: 128 bits of randomness rendered as base64url without
// padding (22 characters). Boards are addressed, not created, in this story.
export const BOARD_ID_BYTES = 16;
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

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
      out += BASE64URL[(value >>> (bits - 6)) & 0b111111];
      bits -= 6;
    }
  }
  if (bits > 0) out += BASE64URL[(value << (6 - bits)) & 0b111111];
  return out;
}
