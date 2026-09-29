import { describe, expect, it } from 'vitest';
import {
  chunkBytes,
  joinChunks,
  shouldCompact,
} from '../../src/worker/board-store';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';

/** Deterministic PRNG so the byte fixtures are stable across runs. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBytes(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  const rand = mulberry32(seed);
  for (let i = 0; i < n; i++) out[i] = Math.floor(rand() * 256);
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('chunkBytes', () => {
  it('zero-length input yields zero chunks', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
  });

  it('a single byte yields one chunk', () => {
    const chunks = chunkBytes(new Uint8Array([0xab]));
    expect(chunks).toHaveLength(1);
    expect(bytesEqual(chunks[0], new Uint8Array([0xab]))).toBe(true);
  });

  it('an exact multiple of the chunk size yields the exact chunk count', () => {
    const data = randomBytes(2 * SNAPSHOT_CHUNK_BYTES, 1);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    for (const chunk of chunks) {
      expect(chunk.byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
    }
    expect(bytesEqual(joinChunks(chunks), data)).toBe(true);
  });

  it('one byte past an exact boundary adds a final 1-byte chunk', () => {
    const data = randomBytes(2 * SNAPSHOT_CHUNK_BYTES + 1, 2);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(3);
    expect(chunks[2]?.byteLength).toBe(1);
    expect(bytesEqual(joinChunks(chunks), data)).toBe(true);
  });

  it('honours a custom chunk size', () => {
    const data = randomBytes(7, 3);
    const chunks = chunkBytes(data, 3);
    expect(chunks.map((c) => c.byteLength)).toEqual([3, 3, 1]);
    expect(bytesEqual(joinChunks(chunks), data)).toBe(true);
  });

  it('every chunk is at most the chunk size', () => {
    const data = randomBytes(SNAPSHOT_CHUNK_BYTES + 1000, 4);
    for (const chunk of chunkBytes(data)) {
      expect(chunk.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    }
  });
});

describe('joinChunks (round-trip property)', () => {
  it('round-trips byte-identically at boundary sizes (0, 1, size, size±1)', () => {
    for (const n of [0, 1, 2, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, 3 * SNAPSHOT_CHUNK_BYTES, 3 * SNAPSHOT_CHUNK_BYTES + 1]) {
      const data = randomBytes(n, n + 10);
      expect(bytesEqual(joinChunks(chunkBytes(data)), data)).toBe(true);
    }
  });

  it('round-trips for a spread of random sizes', () => {
    const rand = mulberry32(99);
    for (let i = 0; i < 20; i++) {
      const n = Math.floor(rand() * (4 * SNAPSHOT_CHUNK_BYTES));
      const data = randomBytes(n, i * 7 + 1);
      expect(bytesEqual(joinChunks(chunkBytes(data)), data)).toBe(true);
    }
  });
});

describe('shouldCompact', () => {
  it('false below both boundaries', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('true at the count boundary (inclusive)', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('true at the bytes boundary (inclusive)', () => {
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });

  it('true above either boundary', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, 0)).toBe(true);
    expect(shouldCompact(0, COMPACTION_BYTES + 1)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, COMPACTION_BYTES + 1)).toBe(true);
  });
});
