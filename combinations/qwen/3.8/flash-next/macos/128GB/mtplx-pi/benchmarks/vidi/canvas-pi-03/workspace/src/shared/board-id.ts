// Board identifiers (sync.worker_entry).
//
// A board id is exactly 16 random bytes rendered as base64url without
// padding (22 characters). The same characters are accepted by the Worker
// route (`isValidBoardId`) and produced by clients and tests
// (`newBoardId`), so an id that is generated is always a valid URL segment
// and a valid Durable Object name.

/** Random bytes per board id (128 bits). */
export const BOARD_ID_BYTES = 16;

/** 22 base64url characters — the exact shape `newBoardId()` produces. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** True when `id` is a well-formed board id. Guards the Durable Object route:
 * anything else (traversal attempts, wrong length, non-base64url characters)
 * is rejected with 400 before any object instance is touched. */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** Generate a fresh board id: 16 CSPRNG bytes, base64url, no padding.
 * Works in the browser, workerd and Node (globalThis.crypto + btoa). */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}