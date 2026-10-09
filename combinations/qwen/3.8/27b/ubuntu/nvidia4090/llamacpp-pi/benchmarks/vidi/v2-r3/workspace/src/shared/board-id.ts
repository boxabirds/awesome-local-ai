/**
 * Board ids: 128 bits of randomness, base64url-encoded without padding.
 * The URL-safe alphabet makes ids safe to put in paths and hard to guess.
 */
export const BOARD_ID_BYTES = 16; // 128 bits of randomness
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/; // base64url of 16 bytes, no padding

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** 16 random bytes -> base64url, no padding, 22 characters. */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** Standard base64url without padding (3 bytes -> 4 chars, last group shortened). */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const has1 = i + 1 < bytes.length;
    const has2 = i + 2 < bytes.length;
    const b1 = has1 ? bytes[i + 1] : 0;
    const b2 = has2 ? bytes[i + 2] : 0;
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 0x3) << 4) | (b1 >> 4)];
    if (has1) out += B64_ALPHABET[((b1 & 0xf) << 2) | (b2 >> 6)];
    if (has2) out += B64_ALPHABET[b2 & 0x3f];
  }
  return out;
}
