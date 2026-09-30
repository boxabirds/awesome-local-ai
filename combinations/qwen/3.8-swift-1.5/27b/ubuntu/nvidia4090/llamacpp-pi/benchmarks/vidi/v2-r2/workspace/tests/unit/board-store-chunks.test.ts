import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';

describe('persist.board_store: chunking (TC-01)', () => {
  it('chunkBytes(0 bytes) → 0 chunks', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
  });

  it('chunkBytes(1 byte) → 1 chunk', () => {
    const chunks = chunkBytes(new Uint8Array([7]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(new Uint8Array([7]));
  });

  it('chunkBytes(SNAPSHOT_CHUNK_BYTES) → exactly 1 chunk', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    for (let i = 0; i < data.length; i++) data[i] = i % 251;
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it('chunkBytes(SNAPSHOT_CHUNK_BYTES + 1) → 2 chunks (last has 1 byte)', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < data.length; i++) data[i] = i % 251;
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1].length).toBe(1);
  });

  it('chunkBytes honours an explicit size', () => {
    const chunks = chunkBytes(new Uint8Array([1, 2, 3, 4, 5]), 2);
    expect(chunks.map((c) => c.length)).toEqual([2, 2, 1]);
  });

  it('joinChunks round-trips byte-identical (0, 1, exact, +1 boundaries)', () => {
    for (const len of [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1]) {
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = (i * 31 + 7) % 256;
      const joined = joinChunks(chunkBytes(data));
      expect(Array.from(joined)).toEqual(Array.from(data));
    }
  });
});

describe('persist.board_store: compaction threshold (TC-02)', () => {
  it('count COMPACTION_UPDATE_COUNT - 1 → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('count exactly COMPACTION_UPDATE_COUNT → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('bytes COMPACTION_BYTES - 1 → false', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('bytes exactly COMPACTION_BYTES → true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });
});
