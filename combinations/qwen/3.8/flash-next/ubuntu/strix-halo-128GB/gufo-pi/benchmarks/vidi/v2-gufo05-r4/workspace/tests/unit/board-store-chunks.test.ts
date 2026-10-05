/**
 * Unit: the arithmetic of a chunked snapshot, and the compaction threshold
 * (TC-01, TC-02).
 *
 * Both are pure functions of bytes and counts, so every boundary the storage
 * code depends on is reachable here without a Durable Object: the chunk size is
 * what keeps a row under the platform's per-row limit, and the threshold is what
 * keeps a board's replay bounded. The boundary values are the interesting ones —
 * zero bytes, one byte, exactly one chunk, one byte more than a chunk.
 */

import { describe, expect, it } from 'vitest';
import {
  chunkBytes,
  joinChunks,
  shouldCompact
} from '../../src/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

/** `length` bytes with a recognisable pattern, so a shuffle is visible. */
function bytes(length: number): Uint8Array {
  const data = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) data[index] = index % 251;
  return data;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let index = 0; index < a.byteLength; index += 1) if (a[index] !== b[index]) return false;
  return true;
}

describe('chunkBytes / joinChunks', () => {
  // TC-01 (boundaries)
  it('makes 0, 1, 1, 2 chunks for 0, 1, one chunk, one chunk + 1 bytes', () => {
    expect(chunkBytes(bytes(0))).toEqual([]);
    expect(chunkBytes(bytes(1))).toHaveLength(1);
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES))).toHaveLength(1);
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1))).toHaveLength(2);
  });

  it('never makes a chunk larger than the size', () => {
    for (const length of [0, 1, 3, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES * 3 + 7]) {
      const chunks = chunkBytes(bytes(length));
      const sizes = chunks.map((chunk) => chunk.byteLength);
      expect(sizes.reduce((total, size) => total + size, 0)).toBe(length);
      for (const size of sizes) expect(size).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      // Only the last chunk may be short.
      for (const chunk of chunks.slice(0, -1)) expect(chunk.byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
    }
  });

  it('round-trips byte for byte at every boundary', () => {
    for (const length of [0, 1, 2, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1]) {
      const data = bytes(length);
      expect(equalBytes(joinChunks(chunkBytes(data)), data), `${length} bytes`).toBe(true);
    }
  });

  it('accepts an explicit chunk size and keeps the order', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    const chunks = chunkBytes(data, 3);
    expect(chunks.map((chunk) => Array.from(chunk))).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(Array.from(joinChunks(chunks))).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('joins nothing into zero bytes', () => {
    expect(joinChunks([]).byteLength).toBe(0);
  });
});

describe('shouldCompact', () => {
  // TC-02 (boundaries)
  it('fires at exactly COMPACTION_UPDATE_COUNT rows and not one before', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('fires at exactly COMPACTION_BYTES and not one byte before', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('is false for an empty or modest log', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(1, 12)).toBe(false);
  });
});
