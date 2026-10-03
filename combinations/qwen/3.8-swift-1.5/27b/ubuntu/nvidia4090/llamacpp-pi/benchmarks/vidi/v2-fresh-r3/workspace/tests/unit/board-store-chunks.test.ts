import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import {
  SNAPSHOT_CHUNK_BYTES,
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
} from '../../src/shared/config';

/** Builds a deterministic byte array of the given length. */
function bytesOf(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('TC-01: chunkBytes / joinChunks boundaries', () => {
  it('chunkBytes(0 bytes) → 0 chunks', () => {
    const chunks = chunkBytes(bytesOf(0));
    expect(chunks).toHaveLength(0);
  });

  it('chunkBytes(1 byte) → 1 chunk', () => {
    const chunks = chunkBytes(bytesOf(1));
    expect(chunks).toHaveLength(1);
  });

  it('chunkBytes(SNAPSHOT_CHUNK_BYTES) → exactly 1 chunk', () => {
    const chunks = chunkBytes(bytesOf(SNAPSHOT_CHUNK_BYTES));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it('chunkBytes(SNAPSHOT_CHUNK_BYTES + 1) → 2 chunks', () => {
    const chunks = chunkBytes(bytesOf(SNAPSHOT_CHUNK_BYTES + 1));
    expect(chunks).toHaveLength(2);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1].length).toBe(1);
  });

  it('joinChunks round-trips byte-identically at every boundary', () => {
    for (const n of [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 2 + 5]) {
      const original = bytesOf(n);
      const chunks = chunkBytes(original);
      const joined = joinChunks(chunks);
      expect(bytesEqual(joined, original), `round-trip failed for ${n} bytes`).toBe(true);
    }
  });

  it('joinChunks([]) → empty', () => {
    expect(joinChunks([])).toHaveLength(0);
  });

  it('custom chunk size is respected', () => {
    const chunks = chunkBytes(bytesOf(10), 3);
    // ceil(10 / 3) = 4 chunks
    expect(chunks).toHaveLength(4);
    const joined = joinChunks(chunks);
    expect(bytesEqual(joined, bytesOf(10))).toBe(true);
  });
});

describe('TC-02: shouldCompact thresholds', () => {
  it('count at COMPACTION_UPDATE_COUNT − 1 → false', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('count at exactly COMPACTION_UPDATE_COUNT → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('bytes at COMPACTION_BYTES − 1 → false', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('bytes at exactly COMPACTION_BYTES → true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('either dimension reaching the threshold is sufficient', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 5, 0)).toBe(true);
    expect(shouldCompact(0, COMPACTION_BYTES + 5)).toBe(true);
    expect(shouldCompact(0, 0)).toBe(false);
  });
});
