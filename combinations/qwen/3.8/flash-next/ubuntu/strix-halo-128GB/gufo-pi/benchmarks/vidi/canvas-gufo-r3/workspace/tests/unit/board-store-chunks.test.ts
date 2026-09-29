import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store-pure';
import { SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '@shared/config';

describe('board-store pure functions', () => {
  describe('TC-01: chunkBytes and joinChunks', () => {
    it('chunkBytes of 0 bytes returns 0 chunks', () => {
      const result = chunkBytes(new Uint8Array(0));
      expect(result).toHaveLength(0);
    });

    it('chunkBytes of 1 byte returns 1 chunk', () => {
      const data = new Uint8Array([42]);
      const result = chunkBytes(data);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(data);
    });

    it('chunkBytes of SNAPSHOT_CHUNK_BYTES returns 1 chunk', () => {
      const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
      const result = chunkBytes(data);
      expect(result).toHaveLength(1);
      expect(result[0].byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
    });

    it('chunkBytes of SNAPSHOT_CHUNK_BYTES + 1 returns 2 chunks', () => {
      const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
      data[SNAPSHOT_CHUNK_BYTES] = 0xff; // mark last byte
      const result = chunkBytes(data);
      expect(result).toHaveLength(2);
      expect(result[0].byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
      expect(result[1].byteLength).toBe(1);
      expect(result[1][0]).toBe(0xff);
    });

    it('joinChunks round-trips byte-identical for empty input', () => {
      const original = new Uint8Array(0);
      const chunks = chunkBytes(original);
      const joined = joinChunks(chunks);
      expect(joined).toEqual(original);
    });

    it('joinChunks round-trips byte-identical for small input', () => {
      const original = new Uint8Array([1, 2, 3, 4, 5]);
      const chunks = chunkBytes(original);
      const joined = joinChunks(chunks);
      expect(joined).toEqual(original);
    });

    it('joinChunks round-trips byte-identical for chunk-boundary input', () => {
      const original = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
      for (let i = 0; i < original.length; i++) original[i] = i % 256;
      const chunks = chunkBytes(original);
      const joined = joinChunks(chunks);
      expect(joined).toEqual(original);
    });

    it('joinChunks round-trips byte-identical for multi-chunk input', () => {
      const original = new Uint8Array(SNAPSHOT_CHUNK_BYTES * 3 + 99);
      for (let i = 0; i < original.length; i++) original[i] = i % 256;
      const chunks = chunkBytes(original);
      expect(chunks.length).toBe(4);
      const joined = joinChunks(chunks);
      expect(joined).toEqual(original);
    });
  });

  describe('TC-02: shouldCompact', () => {
    it('returns false at count COMPACTION_UPDATE_COUNT - 1', () => {
      expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    });

    it('returns true at count COMPACTION_UPDATE_COUNT exactly', () => {
      expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
    });

    it('returns false at bytes COMPACTION_BYTES - 1', () => {
      expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    });

    it('returns true at bytes COMPACTION_BYTES exactly', () => {
      expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
    });

    it('returns true when both thresholds are exceeded', () => {
      expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, COMPACTION_BYTES + 1)).toBe(true);
    });
  });
});
