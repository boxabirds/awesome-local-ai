// Board addresses. A board is reached by its address alone (`/b/<boardId>`
// in the browser, `/api/rooms/<boardId>` for the sync socket), so the id has
// to be unguessable even before story 5 introduces board creation: 16 random
// bytes (128 bits) written as base64url without padding, i.e. 22 characters.

/** Random bytes behind a board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** base64url of BOARD_ID_BYTES with the padding removed: exactly 22 characters. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Is `id` a well-formed board address? Pure, never throws. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** base64url (the URL- and path-safe alphabet) of `bytes`, padding removed. */
function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh, unguessable board id: 16 random bytes as unpadded base64url. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}
