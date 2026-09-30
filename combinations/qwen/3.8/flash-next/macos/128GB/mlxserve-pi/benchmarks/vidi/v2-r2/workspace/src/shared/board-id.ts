// Board addresses. A board id is 128 bits of randomness encoded as unpadded
// base64url, which the PRD asks for so a board address is hard to guess (the
// Worker treats the id as an opaque routing key; creation/validation of board
// existence arrives in story 5).

/** Random bytes behind a board id: 128 bits. */
export const BOARD_ID_BYTES = 16;
/**
 * A board id is the unpadded base64url of BOARD_ID_BYTES: 16 bytes -> 22 base64
 * characters (128 bits / 6 = 21.33, rounded up), using only A–Z a–z 0–9 - and _.
 */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Whether `id` is a well-formed board address. */
export function isValidBoardId(id: string): boolean {
  return typeof id === 'string' && BOARD_ID_PATTERN.test(id);
}

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh, unguessable board id (16 random bytes -> unpadded base64url). */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64url(bytes);
}
