/**
 * Board addresses: the part of `/b/:boardId` (and of the `/api/rooms/:boardId`
 * websocket route) that names one board.
 *
 * A board id is 16 random bytes in base64url without padding: 22 characters, all
 * of them inside `[A-Za-z0-9_-]`, so an address can be pasted into a chat message
 * and a strict pattern can reject anything else before a request reaches a room.
 */

/** Randomness behind one board id, in bytes (128 bits). */
export const BOARD_ID_BYTES = 16;
/** The exact shape of a board id: base64url of {@link BOARD_ID_BYTES} bytes, unpadded. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id. Never throws. */
export function isValidBoardId(id: string): boolean {
  return typeof id === 'string' && BOARD_ID_PATTERN.test(id);
}

/**
 * A new, unguessable board id: {@link BOARD_ID_BYTES} random bytes in base64url,
 * which is 22 characters because 16 bytes pad to 24 with two `=` that are dropped.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
