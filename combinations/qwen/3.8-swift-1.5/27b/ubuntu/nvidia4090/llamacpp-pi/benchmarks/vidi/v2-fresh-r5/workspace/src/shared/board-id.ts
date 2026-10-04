/**
 * Board identifiers: 128 bits of randomness encoded as 22-char base64url
 * (no padding). The pattern is the only validation the Worker performs.
 */

/** Number of random bytes in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** 22-char base64url, no padding — the exact shape of a board id. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Encode bytes as base64url without padding. */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Returns true if the string is a valid board id (22-char base64url).
 */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * Generate a new random board id: 16 random bytes → base64url, 22 chars, no padding.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
