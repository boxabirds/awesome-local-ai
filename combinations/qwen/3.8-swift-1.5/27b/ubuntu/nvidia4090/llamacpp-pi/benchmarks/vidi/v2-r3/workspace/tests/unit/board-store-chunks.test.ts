import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '../../src/shared/config';

describe('TC-01: chunkBytes and joinChunks', () => {
  it('chunkBytes of 0 bytes → 0 chunks', () => {
    const data = new Uint8Array(0);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(0);
  });

  it('chunkBytes of 1 byte → 1 chunk', () => {
    const data = new Uint8Array(1);
    data[0] = 42;
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
    expect(chunks[0][0]).toBe(42);
  });

  it('chunkBytes of exactly SNAPSHOT_CHUNK_BYTES → 1 chunk', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    data.fill(7);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(SNAPSHOT_CHUNK_BYTES);
  });

  it('chunkBytes of SNAPSHOT_CHUNK_BYTES + 1 → 2 chunks', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    data.fill(3);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1]).toHaveLength(1);
  });

  it('joinChunks round-trips byte-identical for 0 bytes', () => {
    const data = new Uint8Array(0);
    const chunks = chunkBytes(data);
    const joined = joinChunks(chunks);
    expect(joined).toHaveLength(0);
  });

  it('joinChunks round-trips byte-identical for 1 byte', () => {
    const data = new Uint8Array([42]);
    const chunks = chunkBytes(data);
    const joined = joinChunks(chunks);
    expect(joined).toEqual(data);
  });

  it('joinChunks round-trips byte-identical for SNAPSHOT_CHUNK_BYTES', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = chunkBytes(data);
    const joined = joinChunks(chunks);
    expect(joined).toEqual(data);
  });

  it('joinChunks round-trips byte-identical for SNAPSHOT_CHUNK_BYTES + 1', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 256;
    const chunks = chunkBytes(data);
    const joined = joinChunks(chunks);
    expect(joined).toEqual(data);
  });
});

describe('TC-02: shouldCompact', () => {
  it('false at count COMPACTION_UPDATE_COUNT - 1', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('true at count exactly COMPACTION_UPDATE_COUNT', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('false at bytes COMPACTION_BYTES - 1', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('true at bytes exactly COMPACTION_BYTES', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('false when both below threshold', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('true when either meets threshold', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES - 1)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES)).toBe(true);
  });
});
