// TC-04: a board address is unguessable.
//
// `createBoard(env)` (src/worker/create-board.ts) is one call to `newBoardId()`
// plus one RPC, so the properties the PRD asks of a link - 22 characters, 128
// bits of randomness, no relation to when the board was made, no collisions in
// ten thousand draws - are properties of the id generator. This is where they are
// checked; the RPC and the HTTP shape are TC-05/TC-15 (integration).

import { describe, expect, it } from 'vitest';
import {
  BOARD_ID_BYTES,
  BOARD_ID_PATTERN,
  isValidBoardId,
  newBoardId,
} from '../../src/shared/board-id';

const DRAW = 10_000;

/** The bytes an id stands for, or null if it is not valid base64url. */
function decode(id: string): Uint8Array | null {
  const b64 = id.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]*=*$/.test(padded)) return null;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

describe('board ids (TC-04)', () => {
  const ids = Array.from({ length: DRAW }, () => newBoardId());

  it('draw 10,000 ids and keep them for the assertions below', () => {
    expect(ids).toHaveLength(DRAW);
  });

  it('produces no duplicate among 10,000 ids', () => {
    expect(new Set(ids).size).toBe(DRAW);
  });

  it('produces 22 characters from the base64url alphabet, every time', () => {
    for (const id of ids) {
      expect(id).toHaveLength(22);
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(isValidBoardId(id)).toBe(true);
    }
  });

  it('encodes 16 random bytes (128 bits) per id', () => {
    expect(BOARD_ID_BYTES).toBe(16);
    for (const id of ids.slice(0, 500)) {
      const bytes = decode(id);
      expect(bytes).not.toBeNull();
      expect(bytes!.byteLength).toBe(BOARD_ID_BYTES);
    }
  });

  it('uses the whole alphabet rather than a subset of it', () => {
    const seen = new Set<string>();
    for (const id of ids.slice(0, 500)) for (const char of id) seen.add(char);
    // 500 ids carry 6000 bytes' worth of alphabet; the tail characters of
    // base64url are constrained, so this counts what must appear, not all 64.
    for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
      expect(seen.has(char)).toBe(true);
    }
  });

  it('does not follow creation order: neighbours share no prefix', () => {
    // A counter or timestamp in the generator would show up as ids drawn one
    // after another agreeing on their leading characters.
    let sameFirst = 0;
    let sameFirstThree = 0;
    for (let i = 1; i < ids.length; i++) {
      if (ids[i]![0] === ids[i - 1]![0]) sameFirst++;
      if (ids[i]!.slice(0, 3) === ids[i - 1]!.slice(0, 3)) sameFirstThree++;
    }
    // Chance alone: 1/64 for one character, 1/262144 for three.
    expect(sameFirst).toBeLessThan(DRAW * 0.05);
    expect(sameFirstThree).toBeLessThan(20);
  });

  it('rejects ids that are not 128 bits of base64url', () => {
    expect(isValidBoardId('')).toBe(false);
    expect(isValidBoardId('abc')).toBe(false);
    expect(isValidBoardId('A'.repeat(21))).toBe(false);
    expect(isValidBoardId('A'.repeat(23))).toBe(false);
    expect(isValidBoardId(`${'A'.repeat(21)}=`)).toBe(false); // padded base64
    expect(isValidBoardId(`${'A'.repeat(21)}+`)).toBe(false); // base64, not base64url
    expect(isValidBoardId(`${'A'.repeat(21)}/`)).toBe(false);
    expect(isValidBoardId('../../etc/passwd')).toBe(false);
    expect(isValidBoardId(newBoardId())).toBe(true);
  });
});
