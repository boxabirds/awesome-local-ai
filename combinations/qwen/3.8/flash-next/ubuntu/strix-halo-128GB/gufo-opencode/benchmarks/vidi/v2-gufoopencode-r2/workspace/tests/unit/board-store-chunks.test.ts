// TC-01: chunkBytes / joinChunks round-trip at the boundaries
// 0, 1, SNAPSHOT_CHUNK_BYTES and SNAPSHOT_CHUNK_BYTES + 1 bytes.

import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

function makeBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + 7) % 256;
  return out;
}

describe('chunkBytes / joinChunks', () => {
  const cases: [string, number][] = [
    ['zero bytes', 0],
    ['one byte', 1],
    ['exactly SNAPSHOT_CHUNK_BYTES', SNAPSHOT_CHUNK_BYTES],
    ['SNAPSHOT_CHUNK_BYTES + 1', SNAPSHOT_CHUNK_BYTES + 1],
    ['SNAPSHOT_CHUNK_BYTES * 2 + 123', SNAPSHOT_CHUNK_BYTES * 2 + 123],
  ];

  for (const [name, length] of cases) {
    it(`round-trips ${name}`, () => {
      const data = makeBytes(length);
      const chunks = chunkBytes(data);
      expect(joinChunks(chunks)).toEqual(data);
    });
  }

  it('zero bytes produces no chunks', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });

  it('keeps every chunk within the size limit', () => {
    for (const [, length] of cases) {
      for (const chunk of chunkBytes(makeBytes(length))) {
        expect(chunk.byteLength).toBeGreaterThan(0);
        expect(chunk.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }
    }
  });

  it('splits 1 byte into one chunk, SNAPSHOT_CHUNK_BYTES into one, +1 into two', () => {
    expect(chunkBytes(makeBytes(1))).toHaveLength(1);
    expect(chunkBytes(makeBytes(SNAPSHOT_CHUNK_BYTES))).toHaveLength(1);
    const two = chunkBytes(makeBytes(SNAPSHOT_CHUNK_BYTES + 1));
    expect(two).toHaveLength(2);
    expect(two[0].byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(two[1].byteLength).toBe(1);
  });

  it('respects an explicit size', () => {
    const chunks = chunkBytes(makeBytes(10), 4);
    expect(chunks.map((c) => c.byteLength)).toEqual([4, 4, 2]);
  });
});

// TC-02: shouldCompact at COMPACTION_UPDATE_COUNT and COMPACTION_BYTES
// boundaries (minus one, exactly).
describe('shouldCompact', () => {
  it('is false below both thresholds', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('is true at exactly either threshold', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true);
  });

  it('is true above either threshold', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, 0)).toBe(true);
    expect(shouldCompact(0, COMPACTION_BYTES + 1)).toBe(true);
  });
});
