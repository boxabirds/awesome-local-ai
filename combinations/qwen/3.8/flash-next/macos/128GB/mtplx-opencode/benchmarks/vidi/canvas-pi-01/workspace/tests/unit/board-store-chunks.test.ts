/**
 * Story 4 · unit tests for chunk/join and shouldCompact (TC-01, TC-02).
 */
import { describe, expect, it } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_UPDATE_COUNT, COMPACTION_BYTES, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

describe('chunkBytes', () => {
  it('TC-01: 0 bytes → 0 chunks', () => {
    const data = new Uint8Array(0);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(0);
  });

  it('TC-01: 1 byte → 1 chunk', () => {
    const data = new Uint8Array([42]);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(new Uint8Array([42]));
  });

  it('TC-01: SNAPSHOT_CHUNK_BYTES → 1 chunk', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    data.fill(0xab);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it('TC-01: SNAPSHOT_CHUNK_BYTES + 1 → 2 chunks', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    data.fill(0xcd);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1]!.byteLength).toBe(1);
  });

  it('TC-01: joinChunks round-trips', () => {
    const data = new Uint8Array(SNAPSHOT_CHUNK_BYTES * 2 + 57);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    const chunks = chunkBytes(data);
    const rejoined = joinChunks(chunks);
    expect(rejoined).toEqual(data);
  });
});

describe('shouldCompact', () => {
  it('TC-02: count below threshold → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('TC-02: count at threshold → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('TC-02: bytes below threshold → false', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('TC-02: bytes at threshold → true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('TC-02: both below → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('TC-02: both at threshold → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true);
  });
});