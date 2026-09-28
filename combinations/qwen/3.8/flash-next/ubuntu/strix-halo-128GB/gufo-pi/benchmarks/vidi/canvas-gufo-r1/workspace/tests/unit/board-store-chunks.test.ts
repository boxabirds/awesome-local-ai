import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store-utils';
import { SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '../../src/shared/config';

describe('TC-01: chunkBytes and joinChunks', () => {
  it('chunkBytes of 0 bytes → 0 chunks', () => {
    const result = chunkBytes(new Uint8Array(0));
    expect(result).toEqual([]);
  });

  it('chunkBytes of 1 byte → 1 chunk', () => {
    const data = new Uint8Array([42]);
    const result = chunkBytes(data);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual(data);
  });

  it('chunkBytes of exactly SNAPSHOT_CHUNK_BYTES → 1 chunk', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const result = chunkBytes(data);
    expect(result.length).toBe(1);
    expect(result[0]).toEqual(data);
  });

  it('chunkBytes of SNAPSHOT_CHUNK_BYTES + 1 → 2 chunks', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const result = chunkBytes(data);
    expect(result.length).toBe(2);
    expect(result[0]!.length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(result[1]!.length).toBe(1);
  });

  it('joinChunks round-trips: 0 bytes', () => {
    const original = new Uint8Array(0);
    const chunks = chunkBytes(original);
    const rejoined = joinChunks(chunks);
    expect(rejoined).toEqual(original);
  });

  it('joinChunks round-trips: 1 byte', () => {
    const original = new Uint8Array([99]);
    const chunks = chunkBytes(original);
    const rejoined = joinChunks(chunks);
    expect(rejoined).toEqual(original);
  });

  it('joinChunks round-trips: exact chunk size', () => {
    const original = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    for (let i = 0; i < original.length; i++) original[i] = i % 256;
    const chunks = chunkBytes(original);
    const rejoined = joinChunks(chunks);
    expect(rejoined).toEqual(original);
  });

  it('joinChunks round-trips: chunk size + 1', () => {
    const original = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < original.length; i++) original[i] = i % 256;
    const chunks = chunkBytes(original);
    const rejoined = joinChunks(chunks);
    expect(rejoined).toEqual(original);
  });

  it('chunkBytes uses custom size parameter when provided', () => {
    const data = new Uint8Array(10);
    const result = chunkBytes(data, 3);
    expect(result.length).toBe(4); // 3+3+3+1
    expect(result[0]!.length).toBe(3);
    expect(result[3]!.length).toBe(1);
  });
});

describe('TC-02: shouldCompact', () => {
  it('returns false at COMPACTION_UPDATE_COUNT - 1', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('returns true at COMPACTION_UPDATE_COUNT', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('returns false at COMPACTION_BYTES - 1', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('returns true at exactly COMPACTION_BYTES', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('returns false below both thresholds', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });
});
