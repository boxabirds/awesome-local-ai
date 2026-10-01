/**
 * Board identifier: generation and validation.
 *
 * A board id is 16 random bytes encoded as base64url (no padding) → 22 characters.
 */

/** Number of random bytes in a board id. */
export const BOARD_ID_BYTES = 16;

/** Pattern a valid board id must match (base64url of 16 bytes, no padding). */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Validate a board id string. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** Generate a new random board id. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function base64UrlEncode(bytes: Uint8Array): string {
  // Convert bytes to a base64url string without padding.
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
