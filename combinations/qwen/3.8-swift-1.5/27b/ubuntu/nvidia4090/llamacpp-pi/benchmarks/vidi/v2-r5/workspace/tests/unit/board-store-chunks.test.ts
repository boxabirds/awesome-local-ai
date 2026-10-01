// tests/unit/board-store-chunks.test.ts
// Unit tests for chunkBytes, joinChunks, and shouldCompact (TC-01, TC-02)

import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '../../src/shared/config';

describe('persist.board_store: chunkBytes (TC-01)', () => {
  it('chunks 0 bytes → 0 chunks', () => {
    const data = new Uint8Array(0);
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(0);
  });

  it('chunks 1 byte → 1 chunk', () => {
    const data = new Uint8Array(1).fill(42);
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(1);
  });

  it('chunks exactly SNAPSHOT_CHUNK_BYTES → 1 chunk', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES).fill(1);
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(1);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it('chunks SNAPSHOT_CHUNK_BYTES + 1 → 2 chunks', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1).fill(2);
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(2);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1].length).toBe(1);
  });

  it('joinChunks round-trips byte-identical', () => {
    const sizes = [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 2 + 500];
    for (const size of sizes) {
      const data = new Uint8Array(size);
      for (let i = 0; i < size; i++) data[i] = i % 256;

      const chunks = chunkBytes(data);
      const joined = joinChunks(chunks);

      expect(joined.length).toBe(data.length);
      expect(joined.every((b, i) => b === data[i])).toBe(true);
    }
  });
});

describe('persist.board_store: shouldCompact (TC-02)', () => {
  it('count at COMPACTION_UPDATE_COUNT - 1 → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('count at COMPACTION_UPDATE_COUNT → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('bytes at COMPACTION_BYTES - 1 → false', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('bytes at COMPACTION_BYTES → true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('both below thresholds → false', () => {
    expect(shouldCompact(100, 1024)).toBe(false);
  });
});
