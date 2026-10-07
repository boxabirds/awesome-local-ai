/**
 * Board ID generation and validation.
 * Story 3 — live collaboration.
 */

export const BOARD_ID_BYTES = 16; // 128 bits of randomness
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/; // base64url of 16 bytes, no padding

/** Generate a random board id as a 22-char base64url string. */
export function newBoardId(): string {
  const buf = crypto.getRandomValues(new Uint8Array(BOARD_ID_BYTES));
  return Buffer.from(buf).toString('base64url');
}

/** Validate a board id string matches the expected pattern. */
export function isValidBoardId(id: string): boolean {
  if (typeof id !== 'string') return false;
  return BOARD_ID_PATTERN.test(id);
}
