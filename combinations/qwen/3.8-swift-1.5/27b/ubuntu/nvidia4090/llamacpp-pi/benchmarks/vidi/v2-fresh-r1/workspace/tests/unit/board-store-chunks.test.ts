// Unit tests for BoardStore pure functions: chunkBytes, joinChunks, shouldCompact.
// TC-01, TC-02.

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

describe('persist.board_store unit', () => {
  describe('TC-01: chunkBytes / joinChunks', () => {
    it('chunks 0 bytes → 0 chunks', () => {
      const chunks = chunkBytes(new Uint8Array(0));
      expect(chunks).toHaveLength(0);
    });

    it('chunks 1 byte → 1 chunk', () => {
      const data = new Uint8Array([42]);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toHaveLength(1);
    });

    it('chunks exactly SNAPSHOT_CHUNK_BYTES → 1 chunk', () => {
      const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toHaveLength(SNAPSHOT_CHUNK_BYTES);
    });

    it('chunks SNAPSHOT_CHUNK_BYTES + 1 → 2 chunks', () => {
      const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(SNAPSHOT_CHUNK_BYTES);
      expect(chunks[1]).toHaveLength(1);
    });

    it('joinChunks round-trips byte-identical (0 bytes)', () => {
      const data = new Uint8Array(0);
      const chunks = chunkBytes(data);
      const joined = joinChunks(chunks);
      expect(Array.from(joined)).toEqual(Array.from(data));
    });

    it('joinChunks round-trips byte-identical (SNAPSHOT_CHUNK_BYTES + 1)', () => {
      const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
      for (let i = 0; i < data.length; i++) data[i] = i % 256;
      const chunks = chunkBytes(data);
      const joined = joinChunks(chunks);
      expect(Array.from(joined)).toEqual(Array.from(data));
    });
  });

  describe('TC-02: shouldCompact', () => {
    it('count at COMPACTION_UPDATE_COUNT - 1 → false', () => {
      expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    });

    it('count at exactly COMPACTION_UPDATE_COUNT → true', () => {
      expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
    });

    it('bytes at COMPACTION_BYTES - 1 → false', () => {
      expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    });

    it('bytes at exactly COMPACTION_BYTES → true', () => {
      expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
    });
  });
});
