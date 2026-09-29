// Board store pure helpers (spec: persist.board_store, TC-01, TC-02).
//
// chunkBytes / joinChunks boundary sizes (0, 1, SNAPSHOT_CHUNK_BYTES,
// SNAPSHOT_CHUNK_BYTES + 1) and the shouldCompact thresholds (count and
// bytes, just below / exactly at).

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

function bytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = i % 251;
  return out;
}

describe('chunkBytes (TC-01)', () => {
  it('chunks 0 bytes into 0 chunks', () => {
    expect(chunkBytes(bytes(0))).toHaveLength(0);
  });

  it('chunks 1 byte into 1 chunk', () => {
    expect(chunkBytes(bytes(1))).toHaveLength(1);
  });

  it('chunks exactly SNAPSHOT_CHUNK_BYTES into 1 chunk', () => {
    const chunks = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.length).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it('chunks SNAPSHOT_CHUNK_BYTES + 1 into 2 chunks (boundary)', () => {
    const chunks = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]?.length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1]?.length).toBe(1);
  });

  it('respects a custom chunk size', () => {
    const chunks = chunkBytes(bytes(10), 3);
    expect(chunks.map((c) => c.length)).toEqual([3, 3, 3, 1]);
  });

  it('joinChunks round-trips byte-identical for every boundary size', () => {
    for (const n of [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1]) {
      const data = bytes(n);
      const rejoined = joinChunks(chunkBytes(data));
      expect(Array.from(rejoined)).toEqual(Array.from(data));
    }
  });
});

describe('shouldCompact (TC-02)', () => {
  it('is false just below the row-count threshold', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('is true at exactly the row-count threshold (boundary)', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('is false just below the byte threshold', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('is true at exactly the byte threshold (boundary)', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('is false below both thresholds', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });
});
