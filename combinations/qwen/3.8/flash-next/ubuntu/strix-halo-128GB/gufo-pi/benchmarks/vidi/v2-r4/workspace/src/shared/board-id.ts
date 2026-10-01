/**
 * Board identifiers: 16 random bytes encoded as base64url (no padding),
 * giving 22 characters that are hard to guess.
 */

export const BOARD_ID_BYTES = 16;
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  // base64url encode without padding
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
