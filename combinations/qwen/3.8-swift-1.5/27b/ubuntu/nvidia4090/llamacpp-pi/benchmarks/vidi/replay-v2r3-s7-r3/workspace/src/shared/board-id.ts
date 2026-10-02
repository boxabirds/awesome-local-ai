export const BOARD_ID_BYTES = 16;
export const BOARD_ID_PATTERN = new RegExp('^[A-Za-z0-9_-]{22}$');

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

function bytesToBase64Url(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    result += BASE64URL_ALPHABET[(b0 >> 2) & 0x3f];
    result += BASE64URL_ALPHABET[((b0 << 4) | (b1 >> 4)) & 0x3f];
    if (i + 1 < bytes.length) {
      result += BASE64URL_ALPHABET[((b1 << 2) | (b2 >> 6)) & 0x3f];
    }
    if (i + 2 < bytes.length) {
      result += BASE64URL_ALPHABET[b2 & 0x3f];
    }
  }
  // No padding for base64url
  return result;
}

export function isValidBoardId(id: string): boolean {
  return BOARD_ID_PATTERN.test(id);
}

export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}
