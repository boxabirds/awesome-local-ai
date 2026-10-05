/**
 * Board addresses (`sync.worker_entry`).
 *
 * A board is reached by its address: `/b/<boardId>` in the browser and
 * `/api/rooms/<boardId>` for the sync WebSocket. The id is the *only* thing
 * that identifies a board, so it doubles as the secret (story 14 is the first
 * story that adds sign-in) and must be hard to guess.
 *
 * Format: 16 random bytes (128 bits) rendered as unpadded base64url — exactly
 * 22 characters from the alphabet `[A-Za-z0-9_-]`.
 */

/** Random bytes behind a board id: 128 bits of entropy. */
export const BOARD_ID_BYTES = 16;
/** A board id is base64url of BOARD_ID_BYTES bytes, without padding. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id. */
export function isValidBoardId(id: string): boolean {
  return typeof id === "string" && BOARD_ID_PATTERN.test(id);
}

/** A fresh, unguessable board id (22 base64url characters). */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

/** base64url (RFC 4648 §5) without padding: `A-Za-z0-9_-` only. */
function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
