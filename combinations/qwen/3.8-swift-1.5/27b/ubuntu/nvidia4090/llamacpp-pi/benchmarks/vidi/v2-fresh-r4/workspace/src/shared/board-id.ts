/**
 * Board id generation and validation.
 * Board ids are 16 bytes of randomness encoded as base64url (no padding), 22 chars.
 */

/** Number of random bytes in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** Pattern for valid board ids: base64url of 16 bytes, no padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * Check whether a string is a valid board id.
 */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * Generate a new random board id (16 bytes → base64url, 22 chars, no padding).
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
