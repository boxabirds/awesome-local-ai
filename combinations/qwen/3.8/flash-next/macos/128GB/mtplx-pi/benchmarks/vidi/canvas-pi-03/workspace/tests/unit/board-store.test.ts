import { describe, expect, it } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

// TC-01 / TC-02 (persist.board_store): the two pure pieces of the storage
// layer — chunking and the compaction threshold — verified at their boundaries.
// Everything that needs real SQLite lives in tests/workers/board-store.test.ts.

function bytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = i % 251;
  return out;
}

describe('chunkBytes / joinChunks (TC-01)', () => {
  it('splits 0, 1, exactly one chunk and one chunk + 1 bytes into 0, 1, 1, 2 chunks', () => {
    expect(chunkBytes(bytes(0))).toHaveLength(0);
    expect(chunkBytes(bytes(1))).toHaveLength(1);
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES))).toHaveLength(1);
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1))).toHaveLength(2);
  });

  it('never produces an empty chunk and never loses bytes', () => {
    for (const size of [1, 2, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES * 3 + 7]) {
      const data = bytes(size);
      const chunks = chunkBytes(data);
      expect(chunks.every((chunk) => chunk.byteLength > 0)).toBe(true);
      expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(size);
      expect(chunks.every((chunk) => chunk.byteLength <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
    }
  });

  it('round-trips byte-identically', () => {
    for (const size of [1, 4096, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 2]) {
      const data = bytes(size);
      const joined = joinChunks(chunkBytes(data));
      expect(joined.byteLength).toBe(size);
      expect(Array.from(joined)).toEqual(Array.from(data));
    }
  });

  it('joins nothing into nothing', () => {
    expect(joinChunks([]).byteLength).toBe(0);
  });
});

describe('shouldCompact (TC-02)', () => {
  it('trips at exactly COMPACTION_UPDATE_COUNT rows and not one before', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('trips at exactly COMPACTION_BYTES and not one byte before', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('trips on either threshold alone, and on an empty log never', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(1, 1)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 10, 10)).toBe(true);
    expect(shouldCompact(1, COMPACTION_BYTES + 10)).toBe(true);
  });
});
