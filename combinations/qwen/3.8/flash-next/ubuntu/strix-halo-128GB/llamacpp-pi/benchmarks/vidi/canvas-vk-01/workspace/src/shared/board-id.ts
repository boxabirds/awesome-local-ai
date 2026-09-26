/**
 * Board addresses (story 3). A board id is 128 bits of randomness rendered as
 * base64url without padding: 22 characters, hard to guess, safe in URLs.
 * Story 5 introduces server-side board creation; in this story `/` redirects
 * to a freshly generated id and the Worker validates incoming ids.
 */

/** Random bytes behind a board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** base64url of BOARD_ID_BYTES with no padding: exactly 22 URL-safe chars. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** Generate a new board id: 16 random bytes -> base64url, 22 chars, no padding. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll(/=+$/g, '');
}
