/**
 * TC-01, TC-02 — board ids (sync.worker_entry).
 *
 * Validation is a pure function, so the unit level covers it fully; the
 * integration suite only checks that the Worker refuses a bad id before
 * touching the Durable Object namespace.
 */
import { describe, expect, it } from 'vitest';

import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id';

/** base64url of 16 bytes (`SPUq8nMPQEGm7c5BpXmzKQ`), i.e. a real board id. */
const VALID_ID = 'SPUq8nMPQEGm7c5BpXmzKQ';

describe('board id shape (TC-01)', () => {
  it('uses 16 random bytes, which encode to 22 base64url characters', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(VALID_ID).toHaveLength(22);
    expect(BOARD_ID_PATTERN.test(VALID_ID)).toBe(true);
  });

  it('accepts a well-formed 22 character base64url id', () => {
    expect(isValidBoardId(VALID_ID)).toBe(true);
  });

  it('accepts the - and _ characters of base64url', () => {
    expect(isValidBoardId('a-_b'.padEnd(22, 'A'))).toBe(true);
  });

  it('rejects 21 and 23 characters (boundary)', () => {
    expect(isValidBoardId(VALID_ID.slice(0, 21))).toBe(false);
    expect(isValidBoardId(`${VALID_ID}A`)).toBe(false);
  });

  it('rejects the padding and + characters of ordinary base64', () => {
    expect(isValidBoardId(`${VALID_ID.slice(0, 21)}+`)).toBe(false);
    expect(isValidBoardId(`${VALID_ID.slice(0, 21)}=`)).toBe(false);
  });

  it('rejects path traversal and an empty id (negative)', () => {
    expect(isValidBoardId('../x')).toBe(false);
    expect(isValidBoardId('../../etc/passwd')).toBe(false);
    expect(isValidBoardId('')).toBe(false);
  });
});

describe('newBoardId (TC-02)', () => {
  it('generates 10,000 ids that all match the pattern with no duplicates', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(id, `id ${id}`).toMatch(BOARD_ID_PATTERN);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});
