export const BOARD_ID_BYTES = 16; // 128 bits of randomness
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/; // base64url of 16 bytes, no padding

/**
 * Validates a board id: must be exactly 22 characters of base64url (A-Z, a-z, 0-9, _, -).
 */
export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/**
 * Generates a new board id: 16 random bytes encoded as base64url (no padding), 22 chars.
 */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  // Convert to base64url without padding
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  // Convert base64 to base64url: replace + with _, / with -, remove padding
  return base64.replace(/\+/g, '_').replace(/\//g, '-').replace(/=+$/, '');
}
