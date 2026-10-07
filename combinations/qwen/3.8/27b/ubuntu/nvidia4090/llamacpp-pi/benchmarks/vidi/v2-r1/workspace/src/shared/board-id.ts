// Board id generation and validation (story 3).

/** 128 bits of randomness encoded as base64url without padding. */
export const BOARD_ID_BYTES = 16;
/** base64url of 16 bytes = ceil(16 * 4 / 3) = 22 chars, no padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const B64URL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Validate a board id string against the expected pattern. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * Generate a new random board id: 16 random bytes → base64url, no padding.
 * Uses crypto.getRandomValues (available in Workers and browsers).
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  // Encode as base64url without padding.
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += B64URL_CHARS[b0 >> 2];
    result += B64URL_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) result += B64URL_CHARS[((b1 & 15) << 2) | (b2 >> 6)];
    if (i + 2 < bytes.length) result += B64URL_CHARS[b2 & 63];
  }
  return result;
}
