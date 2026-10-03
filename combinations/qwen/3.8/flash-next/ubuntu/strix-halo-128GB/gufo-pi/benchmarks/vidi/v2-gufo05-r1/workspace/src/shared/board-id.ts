/**
 * Board addresses.
 *
 * A board is reached by its address (`/b/<boardId>`, `/api/rooms/<boardId>`) and
 * nobody has to create it first in this story, so the only thing that keeps two
 * people's boards apart is that nobody can guess an id. 128 bits of randomness,
 * written as base64url without padding, is 22 characters of `[A-Za-z0-9_-]`.
 *
 * Story 5 moves creation to the server; the shape of an id does not change.
 */

/** Random bytes in a board id. */
export const BOARD_ID_BYTES = 16;

/** Exactly the base64url encoding of `BOARD_ID_BYTES` bytes, no padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Whether `id` can name a board. Anything else gets a 400 and no room. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** base64url of `bytes`, without padding (RFC 4648 §5). */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

/** A fresh, unguessable board id. */
export function newBoardId(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(BOARD_ID_BYTES)));
}
