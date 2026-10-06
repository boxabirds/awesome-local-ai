/**
 * The chunking and the compaction threshold, on their own (TC-01, TC-02).
 *
 * Both of these decide something about a board's durability with no database in sight: how a
 * snapshot is cut into rows that SQLite will happily hold, and when a log has grown enough to
 * be worth folding into a snapshot. The numbers around them live in `config.ts`, so the
 * boundaries are tested against the values the product is actually configured with.
 */

import { describe, expect, it } from 'vitest';

import {
  chunkBytes,
  joinChunks,
  shouldCompact,
} from '../../src/worker/board-store';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';

/** `n` bytes counting up from 0, so a wrong byte order shows up as a difference. */
function bytes(length: number): Uint8Array {
  const data = new Uint8Array(length);
  for (let index = 0; index < length; index++) data[index] = index % 251;
  return data;
}

describe('a snapshot is cut into chunks (TC-01)', () => {
  it('makes no chunk out of nothing, and one out of anything up to the chunk size', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
    expect(chunkBytes(bytes(1))).toHaveLength(1);
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES))).toHaveLength(1);
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1))).toHaveLength(2);
  });

  it('keeps every byte, in order, with none of them in two chunks', () => {
    for (const length of [0, 1, 7, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1]) {
      const data = bytes(length);
      const chunks = chunkBytes(data);
      const sizes = chunks.map((chunk) => chunk.length);
      expect(chunks.reduce((total, chunk) => total + chunk.length, 0), `total for ${String(length)}`).toBe(
        length,
      );
      expect(
        sizes.slice(0, -1).every((size) => size === SNAPSHOT_CHUNK_BYTES),
        `only the last chunk may be short (${String(length)})`,
      ).toBe(true);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
        expect(chunk.length).toBeGreaterThan(0); // an empty row would be a row that means nothing
      }
      expect(joinChunks(chunks).length, `joined length for ${String(length)}`).toBe(length);
    }
  });

  it('round-trips byte for byte', () => {
    for (const length of [0, 1, 513, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES * 2 + 99]) {
      const data = bytes(length);
      const joined = joinChunks(chunkBytes(data));
      expect(Array.from(joined), `round trip of ${String(length)} bytes`).toEqual(
        Array.from(data),
      );
    }
  });

  it('needs more than one chunk for a snapshot bigger than one chunk can hold', () => {
    // The case the story is about: a board whose snapshot no single row may hold. The sizes are
    // exact, because a row of this table is the whole snapshot at that point and a reader has to
    // be able to put them back together in order.
    const snapshot = bytes(SNAPSHOT_CHUNK_BYTES * 3 - 1);
    const chunks = chunkBytes(snapshot);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((chunk) => chunk.length)).toEqual([
      SNAPSHOT_CHUNK_BYTES,
      SNAPSHOT_CHUNK_BYTES,
      SNAPSHOT_CHUNK_BYTES - 1,
    ]);
    expect(joinChunks(chunks)).toEqual(snapshot);
  });

  it('joins nothing into nothing', () => {
    expect(joinChunks([]).length).toBe(0);
  });

  it('refuses a chunk size that could not cut anything', () => {
    // Zero would be an infinite loop of empty rows, and a fraction would cut a byte in half.
    expect(() => chunkBytes(bytes(4), 0)).toThrow(RangeError);
    expect(() => chunkBytes(bytes(4), -1)).toThrow(RangeError);
    expect(() => chunkBytes(bytes(4), 1.5)).toThrow(RangeError);
  });

  it('cuts at a size the caller names, which is how a test reaches several chunks quickly', () => {
    const data = bytes(1000);
    const chunks = chunkBytes(data, 300);
    expect(chunks.map((chunk) => chunk.length)).toEqual([300, 300, 300, 100]);
    expect(joinChunks(chunks)).toEqual(data);
  });
});

describe('the log is folded into a snapshot when it has grown enough (TC-02)', () => {
  it('by update count', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('by bytes, which is the one that matters for a board of long notes', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('not at all while both are below', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(1, 10)).toBe(false);
  });

  it('at the thresholds the caller names, so a test need not make five hundred changes', () => {
    expect(shouldCompact(4, 0, 5, COMPACTION_BYTES)).toBe(false);
    expect(shouldCompact(5, 0, 5, COMPACTION_BYTES)).toBe(true);
  });
});
