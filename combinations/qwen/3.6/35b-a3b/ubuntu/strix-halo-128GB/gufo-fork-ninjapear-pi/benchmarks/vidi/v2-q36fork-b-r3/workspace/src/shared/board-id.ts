/** Board ID helpers for story 3 */

export const BOARD_ID_BYTES = 16; // 128 bits of randomness
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/; // base64url of 16 bytes, no padding

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Encode a Uint8Array as base64url with no padding.
 * We generate exactly 22 characters from 16 bytes (128 bits / 6 ≈ 22).
 */
function encodeBase64Url(bytes: Uint8Array): string {
  let result = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;

    result += B64[(b0 >> 2) & 0x3f];
    result += B64[((b0 & 0x03) << 4) | ((b1 >> 4) & 0x0f)];
    result += B64[((b1 & 0x0f) << 2) | ((b2 >> 6) & 0x03)];
    result += B64[b2 & 0x3f];
  }
  // 16 bytes → ceil(16*4/3) = 22 chars (we take first 22, last char would be padding)
  return result.slice(0, 22);
}

/**
 * Generate a new random board id: 16 crypto bytes → base64url, 22 chars.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

/**
 * Validate that `id` matches the expected board id format.
 */
export function isValidBoardId(id: string): boolean {
  if (typeof id !== 'string') return false;
  return BOARD_ID_PATTERN.test(id);
}
