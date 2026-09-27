/**
 * Board addresses. A board id is 128 bits of randomness rendered as unpadded
 * base64url — 22 URL-safe characters — so it is both hard to guess and safe to put
 * straight into a path and into a Durable Object `idFromName`. Story 5 moves board
 * creation to the server; the id format does not change.
 */

/** Random bytes a board id encodes (128 bits). */
export const BOARD_ID_BYTES = 16;

/** A valid board id: unpadded base64url of {@link BOARD_ID_BYTES} bytes. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a syntactically valid board id. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** Encode bytes as unpadded base64url (URL-safe, no `+`, `/` or `=`). */
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i] as number);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh board id: {@link BOARD_ID_BYTES} random bytes, base64url-encoded. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}
