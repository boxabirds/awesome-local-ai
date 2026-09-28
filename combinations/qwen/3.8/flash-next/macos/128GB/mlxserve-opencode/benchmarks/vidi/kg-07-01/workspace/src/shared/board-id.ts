// Board addresses: /b/<boardId>. Ids are random and long enough to be unguessable (story 5 relies on this).

/** Random bytes in a board id (128 bits). */
export const BOARD_ID_BYTES = 16;
/** base64url of BOARD_ID_BYTES bytes, no padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

export function newBoardId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(BOARD_ID_BYTES));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
