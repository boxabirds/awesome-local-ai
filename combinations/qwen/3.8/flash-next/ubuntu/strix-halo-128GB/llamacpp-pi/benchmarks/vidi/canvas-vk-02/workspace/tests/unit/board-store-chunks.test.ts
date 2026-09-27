/**
 * tests/unit/board-store-chunks.test.ts
 *
 * The pure arithmetic behind `persist.board_store` (TC-01, TC-02): how a
 * snapshot is cut into rows and when the update log is worth folding into a
 * snapshot. Both are functions of numbers alone, so every boundary the design
 * names is a direct call — including the exact threshold, where the behaviour
 * changes.
 *
 * The byte-level work against real SQLite lives in
 * `tests/integration/board-store.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

/** Bytes 0, 1, 2 … mod 256, so a wrong slice is visible in the values. */
function pattern(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = i % 256;
  return bytes;
}

describe('chunkBytes / joinChunks (TC-01)', () => {
  it('makes 0, 1, 1 and 2 chunks at the boundaries 0, 1, size and size + 1', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
    expect(chunkBytes(new Uint8Array([7]))).toHaveLength(1);
    expect(chunkBytes(pattern(SNAPSHOT_CHUNK_BYTES))).toHaveLength(1);
    expect(chunkBytes(pattern(SNAPSHOT_CHUNK_BYTES + 1))).toHaveLength(2);
  });

  it('round-trips every size back to the same bytes', () => {
    for (const size of [0, 1, 2, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 2 + 5]) {
      const source = pattern(size);
      const chunks = chunkBytes(source);
      const joined = joinChunks(chunks);
      expect(joined.byteLength).toBe(size);
      expect(Array.from(joined)).toEqual(Array.from(source));
    }
  });

  it('splits at exact chunk boundaries, largest chunk first', () => {
    const source = pattern(SNAPSHOT_CHUNK_BYTES * 2 + 3);
    const chunks = chunkBytes(source);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([
      SNAPSHOT_CHUNK_BYTES,
      SNAPSHOT_CHUNK_BYTES,
      3,
    ]);
    expect(Array.from(chunks[2] as Uint8Array)).toEqual([
      (SNAPSHOT_CHUNK_BYTES * 2) % 256,
      (SNAPSHOT_CHUNK_BYTES * 2 + 1) % 256,
      (SNAPSHOT_CHUNK_BYTES * 2 + 2) % 256,
    ]);
  });

  it('joins nothing to nothing and one chunk back to itself', () => {
    expect(joinChunks([]).byteLength).toBe(0);
    const one = pattern(9);
    expect(Array.from(joinChunks([one]))).toEqual(Array.from(one));
  });
});

describe('shouldCompact (TC-02)', () => {
  it('turns on at exactly COMPACTION_UPDATE_COUNT rows', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('turns on at exactly COMPACTION_BYTES of log', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('stays off below both thresholds and turns on with either one reached', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES - 1)).toBe(true);
  });
});
