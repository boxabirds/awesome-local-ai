/**
 * Board addresses (anchor `sync.worker_entry`).
 *
 * A board is reached by its address: `/b/<boardId>` in the page, and
 * `/api/rooms/<boardId>` for the live-sync WebSocket. The id is the whole
 * identity of a board - the Durable Object namespace routes every connection
 * for an id to that board's own room, which is what keeps boards separate
 * (`live.isolation`).
 */

/** Random bytes behind a board id: 128 bits, so addresses are hard to guess. */
export const BOARD_ID_BYTES = 16;

/**
 * A board id is those bytes as base64url without padding: exactly 22
 * characters from the URL-safe alphabet.
 */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Is `id` a well-formed board id? (Nothing about it is looked up.) */
export function isValidBoardId(id: string): boolean {
  return typeof id === 'string' && BOARD_ID_PATTERN.test(id);
}

/** base64url (no padding) of the given bytes. */
function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** WebCrypto when this environment has it. */
function webCrypto(): Crypto | undefined {
  return (globalThis as { crypto?: Crypto }).crypto;
}

/** A fresh board address: 16 random bytes, base64url, no padding (22 chars). */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  const crypto = webCrypto();
  if (crypto && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    // Environments without WebCrypto (only possible in tests).
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  return base64Url(bytes);
}
