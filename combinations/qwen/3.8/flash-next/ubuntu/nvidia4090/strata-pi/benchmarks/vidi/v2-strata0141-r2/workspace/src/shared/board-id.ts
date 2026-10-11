/**
 * Board addresses (story 3).
 *
 * A board is reached by its address: `/b/<boardId>` in the browser,
 * `/api/rooms/<boardId>` for the sync WebSocket. The id is the only thing that
 * identifies a board until story 5 introduces board creation, so it must be
 * unguessable (128 bits of randomness) and safe to put in a URL path segment.
 */

/** Random bytes per board id (128 bits). */
export const BOARD_ID_BYTES = 16;
/** Base64url (no padding) of BOARD_ID_BYTES: 22 characters from a 64 symbol alphabet. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id (nothing more, nothing less). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** Uint8Array -> base64url without padding, using only web-standard APIs. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh board id: BOARD_ID_BYTES random bytes, base64url encoded. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}
