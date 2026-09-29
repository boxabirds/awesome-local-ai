import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '@shared/config';

describe('TC-01: chunkBytes boundaries', () => {
  it('chunks 0 bytes → 0 chunks', () => {
    const result = chunkBytes(new Uint8Array(0));
    expect(result).toHaveLength(0);
  });

  it('chunks 1 byte → 1 chunk', () => {
    const data = new Uint8Array([42]);
    const result = chunkBytes(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(new Uint8Array([42]));
  });

  it(`chunks exactly SNAPSHOT_CHUNK_BYTES → 1 chunk`, () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const result = chunkBytes(data);
    expect(result).toHaveLength(1);
    expect(result[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it(`chunks SNAPSHOT_CHUNK_BYTES + 1 → 2 chunks`, () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const result = chunkBytes(data);
    expect(result).toHaveLength(2);
    expect(result[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(result[1].length).toBe(1);
  });

  it('joinChunks round-trips byte-identical for 0 bytes', () => {
    const data = new Uint8Array(0);
    const chunks = chunkBytes(data);
    const joined = joinChunks(chunks);
    expect(joined).toEqual(data);
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
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = chunkBytes(data);
    const joined = joinChunks(chunks);
    expect(joined).toEqual(data);
  });
});

describe('TC-02: shouldCompact boundaries', () => {
  it(`count ${COMPACTION_UPDATE_COUNT - 1}, 0 bytes → false`, () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it(`count ${COMPACTION_UPDATE_COUNT}, 0 bytes → true`, () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it(`count 0, bytes ${COMPACTION_BYTES - 1} → false`, () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it(`count 0, bytes ${COMPACTION_BYTES} → true`, () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });
});
