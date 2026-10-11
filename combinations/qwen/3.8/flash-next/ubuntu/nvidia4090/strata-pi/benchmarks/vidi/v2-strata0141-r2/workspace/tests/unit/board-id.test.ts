import { describe, expect, it } from 'vitest';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

/**
 * TC-01 / TC-02 — board ids (sync.worker_entry).
 *
 * A board address is the only thing separating one board from another, so the
 * validation that routes `/api/rooms/:boardId` is tested here as pure logic
 * before the Worker uses it.
 */

/** base64url (no padding) of the 16 bytes 0x00..0x0f — exactly 22 characters. */
const VALID_ID = 'AAECAwQFBgcICQoLDA0ODw';

describe('isValidBoardId (TC-01)', () => {
  it('accepts a 22 character base64url id', () => {
    expect(VALID_ID).toHaveLength(22);
    expect(isValidBoardId(VALID_ID)).toBe(true);
  });

  it('rejects ids one character off the boundary', () => {
    expect(isValidBoardId(VALID_ID.slice(0, 21))).toBe(false);
    expect(isValidBoardId(`${VALID_ID}x`)).toBe(false);
  });

  it('rejects characters that are base64 but not base64url', () => {
    // 22 characters long, so only the alphabet can be the reason.
    expect(isValidBoardId('foo+bar123456789012345')).toBe(false);
    expect(isValidBoardId('foo/bar123456789012345')).toBe(false);
    expect(isValidBoardId('foo=bar123456789012345')).toBe(false);
  });

  it('rejects path traversal and empty ids', () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId('bad!id')).toBe(false);
    expect(isValidBoardId('with space 123456789012')).toBe(false);
  });

  it('keeps the documented byte count and pattern in step', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    // 16 bytes need 22 base64 characters; the padded form is 24, so the id
    // pattern is the unpadded length.
    expect(Math.ceil((BOARD_ID_BYTES * 8) / 6)).toBe(22);
    expect(4 * Math.ceil(BOARD_ID_BYTES / 3)).toBe(24);
    expect(BOARD_ID_PATTERN).toEqual(/^[A-Za-z0-9_-]{22}$/);
    expect(BOARD_ID_PATTERN.test(VALID_ID)).toBe(true);
  });
});

describe('newBoardId (TC-02)', () => {
  it('produces unpadded base64url of BOARD_ID_BYTES', () => {
    const id = newBoardId();
    expect(id).toHaveLength(22);
    expect(BOARD_ID_PATTERN.test(id)).toBe(true);
  });

  it('generates 10,000 ids that all match the pattern and never repeat', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 10_000; index += 1) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });
});
