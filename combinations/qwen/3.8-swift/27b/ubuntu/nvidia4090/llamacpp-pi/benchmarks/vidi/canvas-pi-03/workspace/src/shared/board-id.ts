/**
 * Story 3: board identifiers.
 *
 * A board is reached by its address `/b/<boardId>`. The id is 16 random bytes
 * encoded as base64url without padding (22 chars). Hard to guess once story 5
 * introduces creation; validation precedes any routing to the room object.
 */

/** Number of random bytes in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** base64url of 16 bytes, no padding: exactly 22 chars. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id (22-char base64url, no padding). */
export function isValidBoardId(id: string): boolean {
  return typeof id === 'string' && BOARD_ID_PATTERN.test(id);
}

/**
 * Generates a new random board id: 16 random bytes -> base64url, no padding
 * (22 chars). Uses the Web Crypto API, available in browsers and workerd.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** Encodes bytes as base64url without padding. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // btoa is available in browsers, workerd and Node.
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
