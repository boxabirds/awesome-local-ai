// Board address identifiers: 128 bits of randomness, base64url without
// padding (22 chars). Story 5 will introduce server-side board creation;
// until then newBoardId() is used by the client for the temporary `/`
// redirect and by tests, never hand-written strings.

export const BOARD_ID_BYTES = 16; // 128 bits of randomness
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/; // base64url of 16 bytes, no padding

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // base64url, no padding
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
