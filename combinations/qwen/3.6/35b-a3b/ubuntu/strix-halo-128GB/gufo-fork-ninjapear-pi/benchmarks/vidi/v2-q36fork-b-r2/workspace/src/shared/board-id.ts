export const BOARD_ID_BYTES = 16; // 128 bits of randomness
export const BOARD_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/; // base64url of 16 bytes, no padding

const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Validate a board id against the expected pattern */
export function isValidBoardId(id: string): boolean {
  if (typeof id !== 'string') return false;
  return BOARD_ID_PATTERN.test(id);
}

/** Encode a Uint8Array to base64url without padding */
function encodeBase64url(bytes: Uint8Array): string {
  let result = '';
  const fullGroups = Math.floor(bytes.length / 3);
  const remainder = bytes.length % 3;

  for (let i = 0; i < fullGroups; i++) {
    const offset = i * 3;
    const a = bytes[offset];
    const b = bytes[offset + 1];
    const c = bytes[offset + 2];
    const triple = (a << 16) | (b << 8) | c;
    result += B64URL[(triple >>> 18) & 0x3f];
    result += B64URL[(triple >>> 12) & 0x3f];
    result += B64URL[(triple >>> 6) & 0x3f];
    result += B64URL[triple & 0x3f];
  }

  // Handle remaining bytes (0, 1, or 2)
  if (remainder === 1) {
    const a = bytes[fullGroups * 3];
    const triple = a << 16;
    result += B64URL[(triple >>> 18) & 0x3f];
    result += B64URL[(triple >>> 12) & 0x3f];
    // Last 2 chars would be padding, skip them
  } else if (remainder === 2) {
    const a = bytes[fullGroups * 3];
    const b = bytes[fullGroups * 3 + 1];
    const triple = (a << 16) | (b << 8);
    result += B64URL[(triple >>> 18) & 0x3f];
    result += B64URL[(triple >>> 12) & 0x3f];
    result += B64URL[(triple >>> 6) & 0x3f];
    // Last char would be padding, skip it
  }
  // remainder === 0: nothing left

  return result;
}

/** Generate a random board id: 16 random bytes → base64url, 22 chars, no padding */
export function newBoardId(): string {
  const bytes = new Uint8Array(BOARD_ID_BYTES);
  crypto.getRandomValues(bytes);
  return encodeBase64url(bytes);
}
