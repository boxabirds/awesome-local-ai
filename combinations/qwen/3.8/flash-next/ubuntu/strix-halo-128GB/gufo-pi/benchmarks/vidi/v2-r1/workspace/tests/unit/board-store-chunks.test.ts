import { describe, expect, it } from 'vitest';

import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

describe('chunkBytes and joinChunks (TC-01)', () => {
  it('chunk of 0 bytes → 0 chunks; join of empty array → empty', () => {
    const chunks = chunkBytes(new Uint8Array(0));
    expect(chunks.length).toBe(0);
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });

  it('chunk of 1 byte → 1 chunk; join round-trips', () => {
    const data = new Uint8Array([42]);
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(1);
    expect(joinChunks(chunks)).toEqual(data);
  });

  it(`chunk of SNAPSHOT_CHUNK_BYTES bytes → 1 chunk; join round-trips`, () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    data.fill(7);
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(1);
    expect(joinChunks(chunks)).toEqual(data);
  });

  it(`chunk of SNAPSHOT_CHUNK_BYTES + 1 bytes → 2 chunks; join round-trips`, () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(2);
    expect(chunks[0].byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1].byteLength).toBe(1);
    expect(joinChunks(chunks)).toEqual(data);
  });

  it('joinChunks round-trips for multiple chunks', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES * 3 + 100);
    for (let i = 0; i < data.length; i++) data[i] = (i * 3) & 0xff;
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(4);
    const restored = joinChunks(chunks);
    expect(restored.byteLength).toBe(data.byteLength);
    expect(restored).toEqual(data);
  });
});

describe('shouldCompact (TC-02)', () => {
  it(`count = COMPACTION_UPDATE_COUNT − 1 → false`, () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it(`count = COMPACTION_UPDATE_COUNT → true`, () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it(`bytes = COMPACTION_BYTES − 1 → false`, () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it(`bytes = COMPACTION_BYTES → true`, () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('both below threshold → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('both at threshold → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true);
  });
});
