/**
 * Board addresses.
 *
 * A board id is the whole of a board's "access control" in story 3: anyone who knows the
 * address can read and edit the board, so an address must be impossible to guess. 16
 * random bytes (128 bits) rendered as unpadded base64url is 22 characters from the
 * alphabet `[A-Za-z0-9_-]`, which is safe in a URL path segment and easy to paste.
 *
 * Story 5 moves creation to the server; the shape of an id does not change.
 */

/** Random bytes behind a board address (128 bits). */
export const BOARD_ID_BYTES = 16;

/** A board address is the unpadded base64url of `BOARD_ID_BYTES` bytes: 22 characters. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is exactly a board address: 22 characters of base64url. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** A fresh, unguessable board address (22 characters, base64url of 16 random bytes). */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // base64url (RFC 4648 §5): `+`/`/` become `-`/`_`, padding dropped (16 bytes -> 22 chars)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
