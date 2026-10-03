/**
 * Unit tests for BoardStore pure functions: chunkBytes, joinChunks, shouldCompact.
 * TC-01: chunking boundaries
 * TC-02: compaction threshold boundaries
 */
import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { SNAPSHOT_CHUNK_BYTES, COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '../../src/shared/config';

describe('board-store chunking (unit)', () => {
  // TC-01: chunkBytes of 0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1 bytes
  // → 0, 1, 1, 2 chunks; joinChunks round-trips byte-identical

  it('TC-01: chunkBytes(0 bytes) → 0 chunks', () => {
    const chunks = chunkBytes(new Uint8Array(0));
    expect(chunks).toHaveLength(0);
  });

  it('TC-01: chunkBytes(1 byte) → 1 chunk', () => {
    const data = new Uint8Array([42]);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(1);
  });

  it('TC-01: chunkBytes(SNAPSHOT_CHUNK_BYTES) → 1 chunk', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(SNAPSHOT_CHUNK_BYTES);
  });

  it('TC-01: chunkBytes(SNAPSHOT_CHUNK_BYTES + 1) → 2 chunks', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1]).toHaveLength(1);
  });

  it('TC-01: joinChunks round-trips byte-identical (0 bytes)', () => {
    const data = new Uint8Array(0);
    const chunks = chunkBytes(data);
    const joined = joinChunks(chunks);
    expect(joined).toHaveLength(0);
  });

  it('TC-01: joinChunks round-trips byte-identical (1 byte)', () => {
    const data = new Uint8Array([42]);
    const chunks = chunkBytes(data);
    const joined = joinChunks(chunks);
    expect(Array.from(joined)).toEqual(Array.from(data));
  });

  it('TC-01: joinChunks round-trips byte-identical (SNAPSHOT_CHUNK_BYTES)', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = chunkBytes(data);
    const joined = joinChunks(chunks);
    expect(Array.from(joined)).toEqual(Array.from(data));
  });

  it('TC-01: joinChunks round-trips byte-identical (SNAPSHOT_CHUNK_BYTES + 1)', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < data.length; i++) data[i] = i % 256;
    const chunks = chunkBytes(data);
    const joined = joinChunks(chunks);
    expect(Array.from(joined)).toEqual(Array.from(data));
  });

  it('TC-01: joinChunks with multiple chunks round-trips', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES * 3 + 17);
    for (let i = 0; i < data.length; i++) data[i] = (i * 7) % 256;
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(4);
    const joined = joinChunks(chunks);
    expect(Array.from(joined)).toEqual(Array.from(data));
  });
});

describe('board-store compaction threshold (unit)', () => {
  // TC-02: shouldCompact at count COMPACTION_UPDATE_COUNT - 1 / exactly,
  // and bytes COMPACTION_BYTES - 1 / exactly → false/true, false/true

  it('TC-02: shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0) → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('TC-02: shouldCompact(COMPACTION_UPDATE_COUNT, 0) → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('TC-02: shouldCompact(0, COMPACTION_BYTES - 1) → false', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('TC-02: shouldCompact(0, COMPACTION_BYTES) → true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('TC-02: shouldCompact(0, 0) → false', () => {
    expect(shouldCompact(0, 0)).toBe(false);
  });

  it('TC-02: shouldCompact(1, 1) → false', () => {
    expect(shouldCompact(1, 1)).toBe(false);
  });
});
