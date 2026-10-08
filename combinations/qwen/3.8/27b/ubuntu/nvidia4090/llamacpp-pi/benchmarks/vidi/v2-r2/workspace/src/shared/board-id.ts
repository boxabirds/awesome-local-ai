/**
 * Board identity for vidi6.
 *
 * A board is reached by its address (`/b/<boardId>`). Board ids are 128 bits
 * of randomness, base64url-encoded without padding (22 characters). Story 5
 * will create boards server-side; until then the client generates them.
 */

/** Number of random bytes in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** 16 bytes base64url without padding: exactly 22 characters of [A-Za-z0-9_-]. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * A fresh, random board id: BOARD_ID_BYTES random bytes, base64url-encoded
 * without padding (16 bytes -> 24 base64 chars minus 2 padding '=' -> 22).
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
