import { describe, expect, it } from 'vitest';
import {
  decodeBoardId,
  encodeBoardId,
  isBoardId,
  newBoardId,
} from '../../src/shared/board-id';

describe('newBoardId', () => {
  it('is a 22-character URL-safe string', () => {
    const id = newBoardId();
    expect(id).toHaveLength(22);
    expect(id).toMatch(/^[a-zA-Z0-9_-]{22}$/);
    expect(isBoardId(id)).toBe(true);
  });

  it('is unguessable (two calls differ, statistically)', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 5000; index += 1) seen.add(newBoardId());
    // 128 random bits: 5000 draws must all be distinct with overwhelming odds.
    expect(seen.size).toBe(5000);
  });

  it('round-trips through encode/decode', () => {
    for (let index = 0; index < 5000; index += 1) {
      const id = newBoardId();
      const bytes = decodeBoardId(id);
      expect(bytes).not.toBeNull();
      expect(bytes).toHaveLength(16);
      expect(encodeBoardId(bytes as Uint8Array)).toBe(id);
    }
  });
});

describe('isBoardId', () => {
  it('accepts Buffer.base64url of 16 random bytes (test fixture form)', () => {
    for (let index = 0; index < 5000; index += 1) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      const encoded = Buffer.from(bytes).toString('base64url');
      expect(encoded).toHaveLength(22);
      expect(isBoardId(encoded)).toBe(true);
      // And it decodes to the same bytes, so the Worker accepts fixture rooms.
      expect(encodeBoardId(decodeBoardId(encoded) as Uint8Array)).toBe(encoded);
    }
  });

  it('rejects the non-id shapes the design calls out (invalid_board_id)', () => {
    const invalid = [
      'not-a-valid-board-id', // wrong length, hyphen
      'short',
      '',
      'a'.repeat(23), // too long
      'a'.repeat(21), // too short
      'a'.repeat(22) + 'A', // 23 chars
      'a'.repeat(30), // "random 30-char string"
      'a!b_c-dEfgHiJkLmNoPqRs', // '!' is outside the alphabet
      'aaaaaaaaaaaaaaaaaaaaaaA', // 23
      'AAAAAAAAAAAAAAAAAAAAAA=', // trailing padding we never emit
    ];
    for (const candidate of invalid) {
      expect(isBoardId(candidate)).toBe(false);
    }
  });

  it('rejects a 22-character string whose trailing sextet carries data bits', () => {
    // 'A' in the last slot is the only valid character when the id is a raw
    // 16-byte value; 'B' encodes two leftover bits, i.e. it is not a board id.
    const body = 'a'.repeat(21);
    expect(isBoardId(`${body}B`)).toBe(true); // shape looks fine
    // …but it does not decode to a clean 16-byte id:
    expect(decodeBoardId(`${body}B`)).toBeNull();
  });
});

describe('decodeBoardId', () => {
  it('rejects non-strings and nullish input', () => {
    expect(decodeBoardId(undefined)).toBeNull();
    expect(decodeBoardId(null)).toBeNull();
    expect(decodeBoardId(12345)).toBeNull();
    expect(decodeBoardId(new Uint8Array(16))).toBeNull();
  });

  it('round-trips every freshly generated id (no false negatives)', () => {
    // Guards the encode/decode contract: a legitimate id must never be rejected,
    // or a real room URL would 426 the browser (design §5).
    for (let index = 0; index < 5000; index += 1) {
      const id = newBoardId();
      expect(decodeBoardId(id)).not.toBeNull();
    }
  });
});
