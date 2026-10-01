import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_UPDATE_COUNT, COMPACTION_BYTES, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

describe('persist.board_store chunking (TC-01)', () => {
  it('chunks 0 bytes into 0 chunks', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
  });

  it('chunks 1 byte into 1 chunk', () => {
    const chunks = chunkBytes(new Uint8Array([7]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(new Uint8Array([7]));
  });

  it('chunks exactly SNAPSHOT_CHUNK_BYTES into 1 chunk', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it('chunks SNAPSHOT_CHUNK_BYTES + 1 into 2 chunks', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1].length).toBe(1);
  });

  it('joinChunks round-trips byte-identical for all boundary sizes', () => {
    for (const len of [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1]) {
      const data = new Uint8Array(len);
      for (let i = 0; i < len; i++) data[i] = (i * 31 + 7) % 256;
      const joined = joinChunks(chunkBytes(data));
      expect(joined).toEqual(data);
    }
  });
});

describe('persist.board_store compaction threshold (TC-02)', () => {
  it('is false just below the count threshold', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('is true at exactly the count threshold', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('is false just below the byte threshold', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('is true at exactly the byte threshold', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });
});
