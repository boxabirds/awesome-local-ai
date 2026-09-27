// Board link codes: 16 random bytes (128 bits) rendered as unpadded base64url,
// i.e. exactly 22 characters from [A-Za-z0-9_-] — characters chat and email
// apps do not break or re-encode. Never derived from time, counters or other
// ids (PRD share.unguessable).

export const BOARD_ID_BYTES = 16; // 128 bits of randomness
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

/** New unguessable board id: 16 cryptographic random bytes as base64url (22 chars). */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i]!;
    const b1 = i + 1 < len ? bytes[i + 1]! : -1;
    const b2 = i + 2 < len ? bytes[i + 2]! : -1;
    out += BASE64URL_ALPHABET[b0 >> 2];
    if (b1 < 0) {
      out += BASE64URL_ALPHABET[(b0 & 0x03) << 4];
    } else if (b2 < 0) {
      out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
      out += BASE64URL_ALPHABET[(b1 & 0x0f) << 2];
    } else {
      out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)];
      out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)];
      out += BASE64URL_ALPHABET[b2 & 0x3f];
    }
  }
  return out;
}
