/**
 * Board ID generation and validation.
 * Board IDs are 16 random bytes encoded as base64url (no padding) = 22 characters.
 */

/** Number of random bytes in a board ID. */
export const BOARD_ID_BYTES = 16;

/** Pattern matching a valid board ID: 22 chars of base64url alphabet. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * Validate a board ID string.
 * Must be exactly 22 characters from the base64url alphabet [A-Za-z0-9_-].
 */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * Generate a new board ID: 16 random bytes → base64url, no padding, 22 chars.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  // Encode as base64url without padding
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
