/**
 * Story 4 unit tests for the pure helpers in persist.board_store:
 * chunkBytes / joinChunks (TC-01) and shouldCompact (TC-02). These are the
 * exact boundary cases the design relies on for chunked snapshots and the
 * compaction threshold.
 */
import { describe, it, expect } from 'vitest';
import {
  SNAPSHOT_CHUNK_BYTES,
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
} from 'src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from 'src/worker/board-store';

function bytes(n: number): Uint8Array {
  // Distinct, deterministic byte values so a mis-ordered join is detectable.
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = i % 251;
  return out;
}

describe('persist.board_store chunking (TC-01)', () => {
  it('chunkBytes of 0 bytes → 0 chunks', () => {
    expect(chunkBytes(bytes(0))).toHaveLength(0);
  });

  it('chunkBytes of 1 byte → 1 chunk', () => {
    const chunks = chunkBytes(bytes(1));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
  });

  it('chunkBytes of exactly SNAPSHOT_CHUNK_BYTES → 1 chunk', () => {
    const chunks = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(SNAPSHOT_CHUNK_BYTES);
  });

  it('chunkBytes of SNAPSHOT_CHUNK_BYTES + 1 → 2 chunks (last has 1 byte)', () => {
    const chunks = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1]).toHaveLength(1);
  });

  it('joinChunks round-trips byte-identical across the boundaries', () => {
    for (const n of [0, 1, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 2 + 7]) {
      const original = bytes(n);
      const rejoined = joinChunks(chunkBytes(original));
      expect(rejoined.length).toBe(n);
      expect(Array.from(rejoined)).toEqual(Array.from(original));
    }
  });

  it('joinChunks of an empty chunk list is an empty byte array', () => {
    expect(Array.from(joinChunks([]))).toEqual([]);
  });
});

describe('persist.board_store compaction threshold (TC-02)', () => {
  it('count just under COMPACTION_UPDATE_COUNT → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('count exactly COMPACTION_UPDATE_COUNT → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('bytes just under COMPACTION_BYTES → false', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('bytes exactly COMPACTION_BYTES → true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('zero rows and zero bytes → false', () => {
    expect(shouldCompact(0, 0)).toBe(false);
  });

  it('either dimension reaching the threshold alone triggers compaction', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });
});
