import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/shared/snapshot-chunks';

/**
 * TC-01 and TC-02: the pure logic of persist.board_store — how a snapshot is
 * split into chunks and put back exactly, and when the log is worth folding in.
 * These are the boundaries the integration tests then exercise against real
 * SQLite; getting them wrong here is the same bug with more setup.
 */

/** `n` bytes numbered by position, so a round-trip proves order is kept. */
function bytes(n: number): Uint8Array {
  return Uint8Array.from({ length: n }, (_unused, i) => i % 256);
}

describe('TC-01: chunkBytes splits, joinChunks puts back', () => {
  it('makes 0, 1, 1, 2 chunks for 0, 1, one, and one-plus-a-byte', () => {
    expect(chunkBytes(bytes(0))).toHaveLength(0);
    expect(chunkBytes(bytes(1))).toHaveLength(1);
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES))).toHaveLength(1);
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1))).toHaveLength(2);
  });

  it('never leaves a trailing empty chunk on an exact multiple', () => {
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES * 3))).toHaveLength(3);
    // and none of them is empty
    for (const chunk of chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES * 3))) {
      expect(chunk.length).toBeGreaterThan(0);
    }
  });

  it('caps every chunk at the chunk size', () => {
    const big = bytes(SNAPSHOT_CHUNK_BYTES * 2 + 7);
    for (const chunk of chunkBytes(big)) expect(chunk.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
  });

  it('round-trips byte-identically at every boundary', () => {
    for (const size of [0, 1, 2, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 4 + 5]) {
      const original = bytes(size);
      expect(Array.from(joinChunks(chunkBytes(original)))).toEqual(Array.from(original));
    }
  });

  it('joins an explicit list of chunks in order', () => {
    const joined = joinChunks([
      Uint8Array.from([1, 2, 3]),
      Uint8Array.from([4]),
      Uint8Array.from([5, 6]),
    ]);
    expect(Array.from(joined)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('TC-02: shouldCompact fires at either threshold, not below both', () => {
  it('is false just below the count threshold and true at it', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('is false just below the byte threshold and true at it', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('is false below both and true above both', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 5, COMPACTION_BYTES + 5)).toBe(true);
  });

  it('does not need both: one threshold alone is enough', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });
});
