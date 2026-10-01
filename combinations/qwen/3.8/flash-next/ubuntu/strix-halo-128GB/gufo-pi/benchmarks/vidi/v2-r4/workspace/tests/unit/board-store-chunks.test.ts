/**
 * TC-01: chunkBytes and joinChunks round-trip at boundaries.
 * TC-02: shouldCompact threshold boundaries.
 */
import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '../../src/shared/config';

describe('TC-01: chunkBytes', () => {
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

  it('SNAPSHOT_CHUNK_BYTES bytes → 1 chunk', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const result = chunkBytes(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(data);
  });

  it('SNAPSHOT_CHUNK_BYTES + 1 bytes → 2 chunks', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const result = chunkBytes(data);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveLength(SNAPSHOT_CHUNK_BYTES);
    expect(result[1]).toHaveLength(1);
  });

  it('joinChunks round-trips for all sizes', () => {
    const sizes = [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 3 + 99];
    for (const size of sizes) {
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) data[i] = i % 256;
      const chunks = chunkBytes(data);
      const joined = joinChunks(chunks);
      expect(joined).toEqual(data);
    }
  });
});

describe('TC-02: shouldCompact', () => {
  it('COMPACTION_UPDATE_COUNT - 1 → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('exactly COMPACTION_UPDATE_COUNT → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('COMPACTION_BYTES - 1 → false', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('exactly COMPACTION_BYTES → true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('both below → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('both above → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, COMPACTION_BYTES + 1)).toBe(true);
  });
});
