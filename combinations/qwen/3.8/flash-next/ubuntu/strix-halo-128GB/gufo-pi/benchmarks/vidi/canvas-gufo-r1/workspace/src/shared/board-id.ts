/** Number of random bytes in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** Base64url of 16 bytes with no padding: exactly 22 characters. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Returns true when `id` is a valid board id (22-char base64url). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** Generate a new board id: 16 random bytes → base64url, 22 chars, no padding. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  // base64url encoding without padding
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
