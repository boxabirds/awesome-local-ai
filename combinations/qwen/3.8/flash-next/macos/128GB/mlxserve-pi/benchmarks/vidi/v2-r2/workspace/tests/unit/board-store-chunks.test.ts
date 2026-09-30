// Board storage's two pure functions (TC-01, TC-02): snapshot chunking and the
// compaction threshold. Both are arithmetic on sizes, so they are tested here
// rather than through SQLite - the storage behaviour around them is covered by
// the integration suite.
//
// TC-01 walks the chunk boundaries the design names (0, 1, exactly one chunk, one
// byte past it) and requires `joinChunks` to give the bytes back unchanged,
// because a snapshot that reloads differently from how it was written is silent
// data loss.
// TC-02 walks both thresholds on both sides, since a compaction that starts one
// row early costs nothing visible while one that never starts grows the load
// time without limit.

import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

function bytes(length: number): Uint8Array {
  // deterministic, non-zero, so a dropped or duplicated chunk cannot look correct
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i % 251) + 1;
  return out;
}

function equals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('snapshot chunking (TC-01)', () => {
  it('splits 0 bytes into 0 chunks', () => {
    expect(chunkBytes(bytes(0))).toEqual([]);
  });

  it('splits 1 byte into 1 chunk', () => {
    expect(chunkBytes(bytes(1)).map((c) => c.length)).toEqual([1]);
  });

  it('splits exactly SNAPSHOT_CHUNK_BYTES into 1 chunk', () => {
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES)).map((c) => c.length)).toEqual([
      SNAPSHOT_CHUNK_BYTES,
    ]);
  });

  it('splits SNAPSHOT_CHUNK_BYTES + 1 into 2 chunks', () => {
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1)).map((c) => c.length)).toEqual([
      SNAPSHOT_CHUNK_BYTES,
      1,
    ]);
  });

  it('never emits an empty or oversized chunk, and every chunk is under the row limit', () => {
    for (const length of [0, 1, 7, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 3 + 40]) {
      const chunks = chunkBytes(bytes(length));
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      expect(total).toBe(length);
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(chunk.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }
    }
  });

  it('joinChunks returns the bytes byte-for-byte at every boundary', () => {
    for (const length of [0, 1, 7, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 2 + 129]) {
      const data = bytes(length);
      expect(equals(joinChunks(chunkBytes(data)), data)).toBe(true);
    }
  });

  it('joins 0 chunks to an empty byte string', () => {
    expect(joinChunks([]).length).toBe(0);
  });

  it('honours an explicit chunk size', () => {
    expect(chunkBytes(bytes(10), 4).map((c) => c.length)).toEqual([4, 4, 2]);
    expect(chunkBytes(bytes(10), 10).map((c) => c.length)).toEqual([10]);
  });

  it('rejects a chunk size that would never advance', () => {
    expect(() => chunkBytes(bytes(4), 0)).toThrow(RangeError);
    expect(() => chunkBytes(bytes(4), -1)).toThrow(RangeError);
  });
});

describe('compaction threshold (TC-02)', () => {
  it('does not compact one row before COMPACTION_UPDATE_COUNT', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('compacts at exactly COMPACTION_UPDATE_COUNT rows', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('does not compact one byte before COMPACTION_BYTES', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('compacts at exactly COMPACTION_BYTES bytes', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('compacts when both thresholds are passed, and not on an empty log', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, COMPACTION_BYTES + 1)).toBe(true);
  });
});
