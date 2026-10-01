import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/shared/persistence';
import { SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '../../src/shared/config';

describe('TC-01: chunkBytes and joinChunks', () => {
  it('0 bytes → 0 chunks', () => {
    const chunks = chunkBytes(new Uint8Array(0));
    expect(chunks).toHaveLength(0);
  });

  it('1 byte → 1 chunk', () => {
    const data = new Uint8Array([42]);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(data);
  });

  it('SNAPSHOT_CHUNK_BYTES bytes → 1 chunk', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    data.fill(0xab);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.length).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it('SNAPSHOT_CHUNK_BYTES + 1 bytes → 2 chunks', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    data.fill(0xcd);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1]!.length).toBe(1);
  });

  it('joinChunks round-trips chunkBytes byte-identical', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES * 3 + 123);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = chunkBytes(data);
    const joined = joinChunks(chunks);
    expect(joined).toEqual(data);
  });

  it('joinChunks of empty array returns empty Uint8Array', () => {
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });

  it('custom chunk size works', () => {
    const data = new Uint8Array(10);
    data.fill(7);
    const chunks = chunkBytes(data, 3);
    expect(chunks).toHaveLength(4);
    expect(chunks[0]!.length).toBe(3);
    expect(chunks[3]!.length).toBe(1);
    expect(joinChunks(chunks)).toEqual(data);
  });
});

describe('TC-02: shouldCompact thresholds', () => {
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
    expect(shouldCompact(1, 1)).toBe(false);
  });

  it('both above thresholds → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, COMPACTION_BYTES + 1)).toBe(true);
  });
});
