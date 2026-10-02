import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store-pure';
import { COMPACTION_UPDATE_COUNT, COMPACTION_BYTES, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

describe('chunkBytes and joinChunks (TC-01)', () => {
  it('empty input returns 0 chunks', () => {
    const result = chunkBytes(new Uint8Array(0));
    expect(result).toHaveLength(0);
  });

  it('1 byte returns 1 chunk', () => {
    const input = new Uint8Array([42]);
    const result = chunkBytes(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(input);
  });

  it('exactly SNAPSHOT_CHUNK_BYTES returns 1 chunk', () => {
    const input = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    const result = chunkBytes(input);
    expect(result).toHaveLength(1);
    expect(result[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it('SNAPSHOT_CHUNK_BYTES + 1 returns 2 chunks', () => {
    const input = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    const result = chunkBytes(input);
    expect(result).toHaveLength(2);
    expect(result[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(result[1].length).toBe(1);
  });

  it('joinChunks round-trips chunkBytes byte-identically', () => {
    const sizes = [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 3 + 42];
    for (const size of sizes) {
      const input = new Uint8Array(size);
      // Fill with pattern
      for (let i = 0; i < size; i++) input[i] = i % 256;
      const chunks = chunkBytes(input);
      const joined = joinChunks(chunks);
      expect(joined).toEqual(input);
    }
  });
});

describe('shouldCompact (TC-02)', () => {
  it('returns false at COMPACTION_UPDATE_COUNT - 1 with 0 bytes', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('returns true at exactly COMPACTION_UPDATE_COUNT with 0 bytes', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('returns false at COMPACTION_BYTES - 1 with 0 count', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('returns true at exactly COMPACTION_BYTES with 0 count', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });
});
