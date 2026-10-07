/**
 * TC-01, TC-02: Unit tests for pure board-store functions.
 */
import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '@/worker/board-store';
import {
  SNAPSHOT_CHUNK_BYTES,
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
} from '@/shared/config';

describe('TC-01: chunkBytes and joinChunks', () => {
  function makeData(length: number): Uint8Array {
    return new Uint8Array(Array.from({ length }, (_, i) => i % 256));
  }

  it('chunkBytes(0 bytes) → []', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
  });

  it('chunkBytes(1 byte) → [1 chunk]', () => {
    const data = makeData(1);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(data);
  });

  it('chunkBytes(SNAPSHOT_CHUNK_BYTES) → [1 chunk]', () => {
    const data = makeData(SNAPSHOT_CHUNK_BYTES);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it('chunkBytes(SNAPSHOT_CHUNK_BYTES + 1) → [2 chunks]', () => {
    const data = makeData(SNAPSHOT_CHUNK_BYTES + 1);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1].length).toBe(1);
  });

  it('chunkBytes(custom size)', () => {
    const data = makeData(100);
    const chunks = chunkBytes(data, 30);
    expect(chunks).toHaveLength(4); // 30+30+30+10
    expect(chunks[0].length).toBe(30);
    expect(chunks[1].length).toBe(30);
    expect(chunks[2].length).toBe(30);
    expect(chunks[3].length).toBe(10);
  });

  it('joinChunks round-trips for empty input', () => {
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });

  it('joinChunks round-trips single chunk', () => {
    const data = makeData(42);
    expect(joinChunks([data])).toEqual(data);
  });

  it('joinChunks round-trips multi-chunk', () => {
    const original = makeData(1000);
    const chunks = chunkBytes(original);
    expect(joinChunks(chunks)).toEqual(original);
  });

  it('joinChunks + chunkBytes are inverses at every boundary', () => {
    for (const len of [0, 1, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, 10000]) {
      const data = makeData(len);
      const chunks = chunkBytes(data);
      const recovered = joinChunks(chunks);
      expect(recovered).toEqual(data);
    }
  });
});

describe('TC-02: shouldCompact thresholds', () => {
  it('count < COMPACTION_UPDATE_COUNT → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('count == COMPACTION_UPDATE_COUNT → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('bytes < COMPACTION_BYTES → false (when count below threshold)', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('bytes == COMPACTION_BYTES → true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('both below threshold → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('either above threshold → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES - 1)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true);
  });
});
