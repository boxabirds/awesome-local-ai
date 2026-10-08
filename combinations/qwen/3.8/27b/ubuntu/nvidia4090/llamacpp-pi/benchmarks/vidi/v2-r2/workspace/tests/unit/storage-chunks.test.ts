/**
 * Story 4, storage (design TC-01, TC-02).
 *
 * Pure chunking/compaction-trigger tests against the real config values;
 * no workerd, no SQLite.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/shared/storage-chunks';

/** Deterministic pseudo-random bytes (content must survive round-trips). */
function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let seed = 0x2545f491;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    out[i] = seed & 0xff;
  }
  return out;
}

function expectSame(a: Uint8Array, b: Uint8Array): void {
  expect(Array.from(a)).toEqual(Array.from(b));
}

describe('TC-01 snapshot chunking', () => {
  it('0, 1, exactly SNAPSHOT_CHUNK_BYTES, and SNAPSHOT_CHUNK_BYTES+1 bytes -> 0, 1, 1, 2 chunks', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);

    const one = chunkBytes(bytes(1));
    expect(one).toHaveLength(1);
    expect(one[0]?.byteLength).toBe(1);

    const exact = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES));
    expect(exact).toHaveLength(1);
    expect(exact[0]?.byteLength).toBe(SNAPSHOT_CHUNK_BYTES);

    const plusOne = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1));
    expect(plusOne).toHaveLength(2);
    expect(plusOne[0]?.byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(plusOne[1]?.byteLength).toBe(1);
  });

  it('joinChunks(chunkBytes(x)) is byte-identical to x for every boundary case', () => {
    for (const length of [
      0,
      1,
      SNAPSHOT_CHUNK_BYTES - 1,
      SNAPSHOT_CHUNK_BYTES,
      SNAPSHOT_CHUNK_BYTES + 1,
      SNAPSHOT_CHUNK_BYTES * 2 - 1,
      SNAPSHOT_CHUNK_BYTES * 2,
      SNAPSHOT_CHUNK_BYTES * 2 + 37,
    ]) {
      const data = bytes(length);
      expectSame(joinChunks(chunkBytes(data)), data);
    }
  });

  it('all chunks but the last are exactly SNAPSHOT_CHUNK_BYTES', () => {
    const data = bytes(SNAPSHOT_CHUNK_BYTES * 3 + 5);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(4);
    for (const chunk of chunks.slice(0, 3)) {
      expect(chunk.byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
    }
    expect(chunks[3]?.byteLength).toBe(5);
  });
});

describe('TC-02 compaction trigger', () => {
  it('count boundary: COMPACTION_UPDATE_COUNT-1 rows is false, exactly COMPACTION_UPDATE_COUNT is true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('byte boundary: COMPACTION_BYTES-1 bytes is false, exactly COMPACTION_BYTES is true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('either condition alone triggers', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 1)).toBe(true);
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });
});
