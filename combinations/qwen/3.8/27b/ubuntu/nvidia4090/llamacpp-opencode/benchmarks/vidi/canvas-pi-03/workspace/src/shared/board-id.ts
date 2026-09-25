/**
 * Board identifiers (story 3).
 *
 * A board id is 16 random bytes (128 bits) encoded as unpadded base64url,
 * i.e. exactly 22 characters from [A-Za-z0-9_-]. Hard to guess once board
 * creation arrives (story 5); the worker rejects anything else with 400.
 */

export const BOARD_ID_BYTES = 16;
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id (22-char base64url, no padding). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * Generates a fresh random board id: 16 random bytes encoded as unpadded
 * base64url (22 characters).
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa produces standard base64 with padding; convert to base64url.
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
