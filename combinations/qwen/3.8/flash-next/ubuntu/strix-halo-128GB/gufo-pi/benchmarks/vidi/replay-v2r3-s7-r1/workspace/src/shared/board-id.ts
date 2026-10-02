/**
 * Board identifiers: 128 random bits encoded as base64url (no padding).
 */
export const BOARD_ID_BYTES = 16; // 128 bits of randomness
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/; // base64url of 16 bytes, no padding

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  // base64url without padding
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const b64 = btoa(binary);
  // Replace +/ with -_ and strip =
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
