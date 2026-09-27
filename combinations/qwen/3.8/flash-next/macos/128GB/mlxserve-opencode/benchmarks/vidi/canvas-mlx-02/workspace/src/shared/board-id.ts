// Board id generation + validation (story 3). A board id is base64url (no
// padding) of BOARD_ID_BYTES random bytes => 22 URL-safe characters with ~128
// bits of entropy, so ids are hard to guess (PRD security interim). Shared by
// the Worker (validation before routing) and the client (creating /b/<id>).

export const BOARD_ID_BYTES = 16; // 128 bits of randomness
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/; // base64url of 16 bytes, no padding

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

// 16 random bytes -> base64url without padding. Uses the Web Crypto RNG that
// exists in both the browser and workerd.
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
