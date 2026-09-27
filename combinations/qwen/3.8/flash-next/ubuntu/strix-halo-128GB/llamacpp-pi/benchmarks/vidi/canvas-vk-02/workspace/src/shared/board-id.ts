/**
 * Board addresses (design "sync.worker_entry").
 *
 * A board is addressed by 128 bits of randomness rendered as unpadded base64url
 * — 22 characters from the alphabet `[A-Za-z0-9_-]`. Story 5 introduces board
 * creation; until then a board is reached by typing (or being given) its
 * address, and the server only checks the *shape* of the id, never whether the
 * board "exists" (joining an empty board gives an empty board).
 */

/** Random bytes behind a board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** Unpadded base64url of `BOARD_ID_BYTES` bytes is exactly 22 characters. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id (shape only, no existence check). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** A fresh, unguessable board id: `BOARD_ID_BYTES` random bytes in base64url. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
