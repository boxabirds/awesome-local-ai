/**
 * Board addresses.
 *
 * A board is reached by its address (`/b/<boardId>`, websocket `/api/rooms/<boardId>`),
 * and one board's Durable Object id is derived from that string, so the id is both the
 * routing key and the whole access control of story 3: anybody who knows the address can
 * edit the board, and nobody can guess one. Story 5 moves creation to the server.
 */

/** Random bytes in a board id: 128 bits, which is 22 base64url characters. */
export const BOARD_ID_BYTES = 16;
/** What a board id looks like: base64url of {@link BOARD_ID_BYTES} bytes, no padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id. Nothing else - existence, ownership - is checked. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** A new, unguessable board id: {@link BOARD_ID_BYTES} random bytes in base64url. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
