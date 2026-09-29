/** 128 bits of randomness. */
export const BOARD_ID_BYTES = 16;
/** base64url of BOARD_ID_BYTES bytes, no padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** A fresh, hard-to-guess board id: BOARD_ID_BYTES random bytes as unpadded base64url. */
export function newBoardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BOARD_ID_BYTES));
  let out = '';
  let bits = 0;
  let acc = 0;
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 6) {
      bits -= 6;
      out += ALPHABET[(acc >> bits) & 63];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += ALPHABET[(acc << (6 - bits)) & 63];
  return out;
}
