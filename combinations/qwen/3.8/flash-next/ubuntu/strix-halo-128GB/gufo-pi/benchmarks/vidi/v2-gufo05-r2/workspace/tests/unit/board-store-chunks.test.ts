/**
 * persist.board_store, unit: the two pure functions behind compaction.
 *
 * TC-01 `chunkBytes` / `joinChunks` at every boundary (0, 1, exactly one chunk,
 *       one byte more than one chunk) and a byte-identical round trip.
 * TC-02 `shouldCompact` at COMPACTION_UPDATE_COUNT − 1 / exactly and
 *       COMPACTION_BYTES − 1 / exactly.
 *
 * The storage itself is exercised against real Durable Object SQLite in
 * `tests/integration/board-store.test.ts`; everything here is byte maths.
 */

import { describe, expect, it } from 'vitest';

import { SNAPSHOT_CHUNK_BYTES, COMPACTION_BYTES, COMPACTION_UPDATE_COUNT } from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

/** `length` bytes of recognisable, non-constant content. */
function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 7 + 3) % 251;
  return out;
}

function sizesOf(chunks: readonly Uint8Array[]): number[] {
  return chunks.map((chunk) => chunk.length);
}

describe('chunkBytes / joinChunks (TC-01)', () => {
  it('produces 0, 1, 1, 2 chunks for 0, 1, one chunk and one chunk + 1 bytes', () => {
    expect(chunkBytes(bytes(0))).toEqual([]);
    expect(sizesOf(chunkBytes(bytes(1)))).toEqual([1]);
    expect(sizesOf(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES)))).toEqual([SNAPSHOT_CHUNK_BYTES]);
    expect(sizesOf(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1)))).toEqual([
      SNAPSHOT_CHUNK_BYTES,
      1,
    ]);
  });

  it('never produces a chunk larger than the chunk size', () => {
    for (const length of [SNAPSHOT_CHUNK_BYTES * 3 - 1, SNAPSHOT_CHUNK_BYTES * 3]) {
      const chunks = chunkBytes(bytes(length));
      expect(chunks.every((chunk) => chunk.length <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
      expect(chunks.reduce((total, chunk) => total + chunk.length, 0)).toBe(length);
    }
  });

  it('honours an explicit chunk size', () => {
    expect(sizesOf(chunkBytes(bytes(7), 3))).toEqual([3, 3, 1]);
    expect(sizesOf(chunkBytes(bytes(6), 3))).toEqual([3, 3]);
  });

  it('round-trips byte-identically, including across chunk boundaries', () => {
    for (const length of [0, 1, 2, 3, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 2 + 40]) {
      const data = bytes(length);
      const joined = joinChunks(chunkBytes(data));
      expect(Array.from(joined)).toEqual(Array.from(data));
    }
  });

  it('joinChunks of no chunks is empty', () => {
    expect(joinChunks([]).length).toBe(0);
  });
});

describe('shouldCompact (TC-02)', () => {
  it('is false below the row threshold and true at it', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('is false below the byte threshold and true at it', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('is false below both thresholds', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });
});
