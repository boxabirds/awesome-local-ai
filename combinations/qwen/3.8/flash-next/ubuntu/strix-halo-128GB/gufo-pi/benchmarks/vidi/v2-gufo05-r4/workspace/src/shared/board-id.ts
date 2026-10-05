/**
 * Board addresses.
 *
 * A board is reached by its address (`/b/<boardId>`, and the matching
 * `/api/rooms/<boardId>` WebSocket route). Nothing in story 3 registers a board,
 * so the only rule an address has to follow is that it is hard to guess: 128 bits
 * of randomness, written as 22 base64url characters. Story 5 moves generation to
 * a server-side "new board" endpoint; the shape stays the same.
 */

/** Random bytes in a board id. */
export const BOARD_ID_BYTES = 16;

/** base64url of BOARD_ID_BYTES, no padding: exactly 22 URL-safe characters. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Does `id` look like a board address? Never throws, whatever the URL contains. */
export function isValidBoardId(id: string): boolean {
  return typeof id === 'string' && BOARD_ID_PATTERN.test(id);
}

/** base64url of `bytes`, with the padding stripped (22 characters for 16 bytes). */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** A fresh board address: BOARD_ID_BYTES of `crypto.getRandomValues`, base64url. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}
