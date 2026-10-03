/** 128 bits of randomness, encoded as base64url (22 chars, no padding). */
export const BOARD_ID_BYTES = 16;

/** Regex for a valid board id: 22 base64url characters. */
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

/** Returns true if `id` is a valid board id (22 base64url chars). */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * Generates a new random board id: 16 random bytes → base64url, no padding (22 chars).
 * Uses crypto.getRandomValues for cryptographic randomness.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

/** Encodes bytes as base64url (no padding). */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
