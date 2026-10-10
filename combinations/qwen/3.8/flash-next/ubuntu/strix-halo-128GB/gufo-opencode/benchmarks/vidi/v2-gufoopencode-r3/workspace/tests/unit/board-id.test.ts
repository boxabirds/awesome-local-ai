import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId
} from '../../src/shared/board-id';

// TC-01: validation accepts a valid 22-char base64url id and rejects
// boundary lengths and out-of-alphabet characters.
describe('isValidBoardId (TC-01)', () => {
  const valid = 'Zk3_-xQ9aB7cD2eF5gH8iJ'; // 22 chars, base64url alphabet

  it('accepts a 22-char base64url id', () => {
    expect(valid).toHaveLength(22);
    expect(isValidBoardId(valid)).toBe(true);
  });

  it('rejects 21 and 23 characters (boundary)', () => {
    expect(isValidBoardId(valid.slice(0, 21))).toBe(false);
    expect(isValidBoardId(valid + 'x')).toBe(false);
  });

  it('rejects a plus sign (not in the base64url alphabet)', () => {
    expect(isValidBoardId('Zk3+xQ9aB7cD2eF5gH8iJ1')).toBe(false);
  });

  it('rejects a path traversal attempt', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isValidBoardId('')).toBe(false);
  });

  it('pattern matches generated ids and encodes 16 bytes of randomness', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    expect(newBoardId()).toMatch(BOARD_ID_PATTERN);
  });
});

// TC-02: 10,000 generated ids all match the pattern and none collide.
describe('newBoardId (TC-02)', () => {
  it('generates 10,000 unique ids matching the pattern', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      ids.add(id);
    }
    expect(ids.size).toBe(10_000);
  });
});
