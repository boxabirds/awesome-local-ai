/**
 * Board identifiers: validation and generation.
 */

/** 16 bytes = 128 bits of randomness. */
export const BOARD_ID_BYTES = 16;

/** Base64url of 16 bytes, no padding: exactly 22 characters from [A-Za-z0-9_-]. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a valid board identifier. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * Generate a new random board id: 16 random bytes encoded as base64url
 * without padding, yielding exactly 22 characters.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64urlEncode(bytes);
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const b64 = btoa(binary);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
