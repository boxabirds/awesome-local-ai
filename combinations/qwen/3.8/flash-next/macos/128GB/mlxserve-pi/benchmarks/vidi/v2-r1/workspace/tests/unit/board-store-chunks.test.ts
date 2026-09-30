import { describe, expect, it } from 'vitest';
import { SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';
import { chunkBytes, joinChunks } from '../../src/worker/board-store';

/**
 * TC-01 (persist.room "the snapshot is stored in chunks").
 *
 * The snapshot is written to SQLite in chunks: a 2000-note board is 200-400 KB,
 * close to the per-row size limit of Durable Object SQLite, so a snapshot that
 * grows past a row's limit must not be one row. Unit level: chunkBytes and
 * joinChunks round-trip for 0, 1, exactly one chunk's worth, and one more.
 *
 * The integration suite covers the storage half (TC-04, TC-05, TC-06).
 */

/** `size` bytes of a repeating-but-checkable pattern. */
const pattern = (size: number): Uint8Array =>
  Uint8Array.from({ length: size }, (_, i) => (i * 7 + (i % 251)) % 256);

const N = SNAPSHOT_CHUNK_BYTES;

describe('chunkBytes (TC-01)', () => {
  it('turns zero bytes into zero chunks', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
  });

  it('turns one byte into one chunk', () => {
    const chunks = chunkBytes(new Uint8Array([7]));
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0]!)).toEqual([7]);
  });

  it('keeps exactly one chunk worth in one chunk', () => {
    const chunks = chunkBytes(pattern(N));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.byteLength).toBe(N);
  });

  it('splits one byte past a chunk into two chunks', () => {
    const chunks = chunkBytes(pattern(N + 1));
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([N, 1]);
  });

  it('splits several chunks with a partial one at the end', () => {
    const chunks = chunkBytes(pattern(N * 3 + N / 2), N);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([N, N, N, N / 2]);
  });

  it('never yields an empty chunk', () => {
    for (const size of [0, 1, N - 1, N, N + 1, N * 2]) {
      for (const chunk of chunkBytes(pattern(size))) {
        expect(chunk.byteLength).toBeGreaterThan(0);
        expect(chunk.byteLength).toBeLessThanOrEqual(N);
      }
    }
  });
});

describe('joinChunks (TC-01)', () => {
  it('joins zero chunks into zero bytes', () => {
    expect(joinChunks([]).byteLength).toBe(0);
  });

  it('round-trips 0, 1, one chunk, and one chunk plus one bytes', () => {
    for (const size of [0, 1, N, N + 1]) {
      const data = pattern(size);
      const joined = joinChunks(chunkBytes(data));
      expect(joined.byteLength).toBe(size);
      expect(Array.from(joined)).toEqual(Array.from(data));
    }
  });

  it('round-trips a size that spans a chunk boundary several times', () => {
    const data = pattern(N * 2 + 1234);
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(3);
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(data));
  });
});
