/**
 * Board id generation and validation.
 *
 * A board id is 16 bytes of randomness encoded as unpadded base64url:
 * exactly 22 characters from [A-Za-z0-9_-].
 */

/** Bytes of randomness in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;
/** Exactly 22 base64url characters, no padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/**
 * True if `id` is a well-formed board id (22 base64url chars).
 */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * Generate a new random board id: 16 random bytes → unpadded base64url (22 chars).
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  // base64url, no padding
  const b64 = btoa(String.fromCharCode(...bytes));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
