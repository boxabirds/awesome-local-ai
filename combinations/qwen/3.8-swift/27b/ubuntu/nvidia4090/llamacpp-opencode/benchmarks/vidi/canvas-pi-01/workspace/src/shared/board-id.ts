// Board identifiers (see spec: sync.worker_entry).
//
// A board id is 16 bytes of randomness, base64url-encoded without padding:
// exactly 22 characters of [A-Za-z0-9_-]. The same pattern validates ids on
// the worker route (/api/rooms/:boardId) and in the client route (/b/:id).

export const BOARD_ID_BYTES = 16;
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed 22-char base64url board id. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** base64url without padding (global btoa in the browser, workerd and Node). */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Generate a fresh board id (16 random bytes, base64url, no padding). */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}
