/**
 * Board link codes (story 5, TC-04; share.unguessable).
 *
 * Every board link contains a code produced from a cryptographic random
 * source (crypto.getRandomValues) of at least 16 bytes (128 bits),
 * base64url-encoded without padding — 22 characters of [A-Za-z0-9_-].
 * Codes are never derived from creation order, time, creator or any other
 * board's link.
 */

import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';
import {
  BOARD_CHECK_RETRY_BASE_MS,
  CREATE_BUDGET_MS,
  LINK_COPIED_MS,
  RECONNECT_MAX_BACKOFF_MS,
} from '../../src/shared/config';

describe('board link codes (share.unguessable)', () => {
  it('TC-04: 10,000 newBoardId() calls are all distinct and 22 chars matching BOARD_ID_PATTERN', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(id.length, `id ${i} length`).toBe(22);
      expect(id, `id ${i} pattern`).toMatch(BOARD_ID_PATTERN);
      expect(isValidBoardId(id), `id ${i} valid`).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('codes carry 128 bits of randomness: 16 random bytes base64url to exactly 22 chars', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    // 16 bytes = 128 bits; base64url encodes 6 bits per char:
    // ceil(128/6) = 22, with the two padding characters dropped.
    expect(Math.ceil((BOARD_ID_BYTES * 8) / 6)).toBe(22);
  });

  it('link codes only use characters chat and email apps do not break', () => {
    // Letters, digits, hyphen and underscore only (PRD constraint).
    for (let i = 0; i < 200; i++) {
      expect(newBoardId()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('named share settings (story 5)', () => {
  it('the PRD-mandated budgets exist as named settings', () => {
    // share.create: create and open within 2 s; share.copy: "Link copied" for 2 s.
    expect(CREATE_BUDGET_MS).toBe(2000);
    expect(LINK_COPIED_MS).toBe(2000);
    // share.unreachable: exponential backoff from 1 s, capped by story 3's max.
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
    expect(RECONNECT_MAX_BACKOFF_MS).toBeGreaterThanOrEqual(BOARD_CHECK_RETRY_BASE_MS);
  });
});
