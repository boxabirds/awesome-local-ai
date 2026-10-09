/**
 * TC-04: link-code format and uniqueness (share.unguessable).
 *
 * Every board link must carry a random code of at least 128 bits that is not
 * derived from creation order, time, creator or any other board. The code is
 * 16 random bytes base64url-encoded without padding: 22 characters from the
 * chat/email-safe alphabet (letters, digits, hyphen, underscore).
 */
import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  base64UrlEncode,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  CREATE_BUDGET_MS,
  LINK_COPIED_MS,
} from '../../src/shared/config';

describe('TC-04: board link codes (share.unguessable)', () => {
  it('codes carry 128 bits of randomness (16 bytes from a crypto source)', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    // 16 bytes base64url without padding is exactly 22 characters
    const bytes = new Uint8Array(BOARD_ID_BYTES);
    crypto.getRandomValues(bytes);
    expect(base64UrlEncode(bytes)).toHaveLength(22);
    expect(base64UrlEncode(bytes)).toMatch(BOARD_ID_PATTERN);
  });

  it('10,000 generated codes are all unique and all 22 chars matching BOARD_ID_PATTERN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('the story 5 named settings exist with their PRD values', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
  });
});
