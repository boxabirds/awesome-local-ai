/**
 * Unit tests for board ID generation (TC-04: share.unguessable).
 *
 * Verifies that newBoardId() produces 22-character strings matching BOARD_ID_PATTERN,
 * all unique across 10,000 calls, and derived from 16 random bytes (128 bits).
 */
import { describe, expect, test } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';
import { CREATE_BUDGET_MS, LINK_COPIED_MS, BOARD_CHECK_RETRY_BASE_MS } from '../../src/shared/config';

describe('board id generation (TC-04: share.unguessable)', () => {
  test('BOARD_ID_BYTES is 16 (128 bits)', () => {
    expect(BOARD_ID_BYTES).toBe(16);
  });

  test('10,000 newBoardId() calls: all 22 chars, all match BOARD_ID_PATTERN, all unique', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(isValidBoardId(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });

  test('ids use only URL-safe characters (letters, digits, hyphen, underscore)', () => {
    for (let i = 0; i < 1000; i += 1) {
      const id = newBoardId();
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('story 5 named settings', () => {
  test('CREATE_BUDGET_MS is 2000', () => {
    expect(CREATE_BUDGET_MS).toBe(2000);
  });

  test('LINK_COPIED_MS is 2000', () => {
    expect(LINK_COPIED_MS).toBe(2000);
  });

  test('BOARD_CHECK_RETRY_BASE_MS is 1000', () => {
    expect(BOARD_CHECK_RETRY_BASE_MS).toBe(1000);
  });
});
