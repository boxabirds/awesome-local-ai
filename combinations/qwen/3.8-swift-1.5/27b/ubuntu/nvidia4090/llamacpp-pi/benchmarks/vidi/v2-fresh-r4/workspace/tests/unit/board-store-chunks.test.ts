import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '../../src/shared/config';

// --- TC-01: chunking boundaries -------------------------------------------

describe('TC-01: chunkBytes / joinChunks boundaries', () => {
  it('chunks 0 bytes into 0 chunks', () => {
    const chunks = chunkBytes(new Uint8Array(0));
    expect(chunks).toHaveLength(0);
  });

  it('chunks 1 byte into 1 chunk', () => {
    const chunks = chunkBytes(new Uint8Array([7]));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(new Uint8Array([7]));
  });

  it('chunks exactly SNAPSHOT_CHUNK_BYTES into 1 chunk', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    for (let i = 0; i < data.length; i++) data[i] = i % 251;
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it('chunks SNAPSHOT_CHUNK_BYTES + 1 into 2 chunks', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < data.length; i++) data[i] = i % 251;
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1].length).toBe(1);
  });

  it('joinChunks round-trips byte-identical for every boundary case', () => {
    const sizes = [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1];
    for (const size of sizes) {
      const data = new Uint8Array(size);
      for (let i = 0; i < data.length; i++) data[i] = (i * 31 + 7) % 256;
      const chunks = chunkBytes(data);
      const joined = joinChunks(chunks);
      expect(joined).toEqual(data);
    }
  });

  it('chunk sizes never exceed the chunk size', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES * 3 + 5);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(4);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
  });
});

// --- TC-02: compaction threshold boundaries --------------------------------

describe('TC-02: shouldCompact thresholds', () => {
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

  it('zero rows and zero bytes → false', () => {
    expect(shouldCompact(0, 0)).toBe(false);
  });
});
