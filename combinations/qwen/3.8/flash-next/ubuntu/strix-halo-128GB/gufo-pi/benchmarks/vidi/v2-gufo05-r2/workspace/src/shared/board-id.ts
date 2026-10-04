/**
 * Board addresses. A board id is the whole of a board's "secret" until story 5
 * introduces board creation: it is 128 bits of randomness, base64url encoded
 * with no padding, so 22 characters long and impossible to guess by enumeration.
 */

/** Random bytes in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** base64url of `BOARD_ID_BYTES` bytes, padding stripped: exactly 22 chars. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id (nothing about it existing yet). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** A fresh board id: `BOARD_ID_BYTES` crypto-random bytes as base64url. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** base64url (RFC 4648 §5) with the `=` padding stripped: 16 bytes -> 22 chars. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

