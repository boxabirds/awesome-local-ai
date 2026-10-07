import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import {
  SNAPSHOT_CHUNK_BYTES,
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
} from '../../src/shared/config';

// TC-01: chunkBytes boundaries (unit)
describe('TC-01: chunkBytes & joinChunks round-trip', () => {
  it('0 bytes → 0 chunks', () => {
    const result = chunkBytes(new Uint8Array(0));
    expect(result).toHaveLength(0);
  });

  it('1 byte → 1 chunk', () => {
    const data = new Uint8Array([42]);
    const result = chunkBytes(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(data);
  });

  it(`${SNAPSHOT_CHUNK_BYTES} bytes → 1 chunk`, () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES).fill(1);
    const result = chunkBytes(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(data);
  });

  it(`${SNAPSHOT_CHUNK_BYTES + 1} bytes → 2 chunks`, () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1).fill(3);
    const result = chunkBytes(data);
    expect(result).toHaveLength(2);
    expect(result[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(result[1].length).toBe(1);
  });

  it('joinChunks round-trips byte-identically for all cases above', () => {
    // 0 bytes
    expect(joinChunks([])).toEqual(new Uint8Array(0));

    // 1 byte
    const one = new Uint8Array([42]);
    expect(joinChunks(chunkBytes(one))).toEqual(one);

    // exact boundary
    const boundary = new Uint8Array(SNAPSHOT_CHUNK_BYTES).fill(5);
    expect(joinChunks(chunkBytes(boundary))).toEqual(boundary);

    // over boundary
    const over = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1).fill(7);
    expect(joinChunks(chunkBytes(over))).toEqual(over);

    // multiple chunks
    const many = new Uint8Array(SNAPSHOT_CHUNK_BYTES * 3 + 100).fill(9);
    expect(joinChunks(chunkBytes(many))).toEqual(many);
  });

  it('custom size works correctly', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const result = chunkBytes(data, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual(new Uint8Array([1, 2, 3]));
    expect(result[1]).toEqual(new Uint8Array([4, 5, 6]));
    expect(result[2]).toEqual(new Uint8Array([7, 8]));
    expect(joinChunks(result)).toEqual(data);
  });
});

// TC-02: shouldCompact thresholds (unit)
describe('TC-02: shouldCompact count and bytes thresholds', () => {
  it('count below threshold → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('count exactly at threshold → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('bytes below threshold but high count → true by count alone', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES - 1)).toBe(true);
  });

  it('high bytes below threshold but low count → false', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('bytes exactly at threshold → true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('both under threshold → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });
});
