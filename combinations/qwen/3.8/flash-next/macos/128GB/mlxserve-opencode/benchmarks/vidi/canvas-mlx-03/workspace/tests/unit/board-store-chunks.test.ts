// Unit tests for the pure maths behind persist.board_store: snapshot chunking
// (TC-01) and the compaction threshold (TC-02). Every boundary the design names
// is exercised: 0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1 bytes and
// COMPACTION_UPDATE_COUNT − 1 / exactly, COMPACTION_BYTES − 1 / exactly.
import { describe, expect, it } from 'vitest';
import {
  chunkBytes,
  joinChunks,
  shouldCompact,
} from '../../src/worker/board-store.ts';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config.ts';

/** `n` bytes of distinguishable content (so a mis-joined chunk is visible). */
function bytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = (i * 31 + 7) & 0xff;
  return a;
}

describe('TC-01 chunkBytes / joinChunks boundaries', () => {
  it('0 bytes produces 0 chunks and joins back to an empty array', () => {
    const chunks = chunkBytes(new Uint8Array(0));
    expect(chunks).toHaveLength(0);
    expect(joinChunks(chunks).length).toBe(0);
  });

  it('1 byte produces exactly 1 chunk that joins back byte-identical', () => {
    const data = bytes(1);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(data));
  });

  it('exactly SNAPSHOT_CHUNK_BYTES bytes produces 1 chunk that round-trips', () => {
    const data = bytes(SNAPSHOT_CHUNK_BYTES);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(data));
  });

  it('SNAPSHOT_CHUNK_BYTES + 1 bytes produces 2 chunks that round-trip', () => {
    const data = bytes(SNAPSHOT_CHUNK_BYTES + 1);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1]!.length).toBe(1);
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(data));
  });

  it('a many-chunk input keeps every chunk within the size limit and round-trips', () => {
    const data = bytes(SNAPSHOT_CHUNK_BYTES * 3 + 40);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(4);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    expect(chunks.reduce((n, c) => n + c.length, 0)).toBe(data.length);
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(data));
  });

  it('joinChunks of nothing is empty and of one chunk equals that chunk', () => {
    expect(joinChunks([]).length).toBe(0);
    const one = bytes(7);
    expect(Array.from(joinChunks([one]))).toEqual(Array.from(one));
  });
});

describe('TC-02 shouldCompact thresholds', () => {
  it('is false just below the row threshold and true exactly at it', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('is false just below the byte threshold and true exactly at it', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('is false below both thresholds and true above both', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 5, COMPACTION_BYTES + 5)).toBe(true);
  });
});
