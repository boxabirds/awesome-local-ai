/**
 * Unit tests for the two pure pieces of board storage: cutting a snapshot into rows,
 * and deciding when the log has become long enough to fold away (TC-01, TC-02).
 *
 * Both are arithmetic, and both are the kind of arithmetic that is wrong by one in the
 * interesting case: a snapshot of exactly one chunk's size, and a log of exactly the
 * compaction threshold. So the tests are written around those boundaries rather than
 * around the middle, and the round trip is checked byte by byte — a chunk that lost a
 * byte at a boundary would be caught here, where the failure is one line, rather than
 * in a Durable Object where it reads as a corrupt board.
 */
import { describe, expect, it } from 'vitest';

import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

/** `length` bytes that say where they came from, so a shuffled chunk is visible. */
function bytesOf(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = index % 251;
  return bytes;
}

describe('splitting a snapshot into rows (TC-01)', () => {
  it('makes no row out of nothing', () => {
    expect(chunkBytes(bytesOf(0))).toEqual([]);
  });

  it('makes one row out of one byte, and out of a whole row', () => {
    expect(chunkBytes(bytesOf(1)).map((chunk) => chunk.byteLength)).toEqual([1]);
    expect(chunkBytes(bytesOf(SNAPSHOT_CHUNK_BYTES)).map((chunk) => chunk.byteLength)).toEqual([
      SNAPSHOT_CHUNK_BYTES,
    ]);
  });

  it('makes a second row for the one byte that does not fit', () => {
    expect(chunkBytes(bytesOf(SNAPSHOT_CHUNK_BYTES + 1)).map((chunk) => chunk.byteLength)).toEqual([
      SNAPSHOT_CHUNK_BYTES,
      1,
    ]);
  });

  it('puts the rows back into exactly what it was given', () => {
    for (const length of [0, 1, 7, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1]) {
      const data = bytesOf(length);
      const chunks = chunkBytes(data);
      const joined = joinChunks(chunks);
      expect(joined.byteLength, `${length} bytes`).toBe(length);
      expect(Array.from(joined)).toEqual(Array.from(data));
      // Nothing was wasted: the rows hold the data and nothing else.
      expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(length);
    }
  });

  it('holds the bytes in the order they went in, for a snapshot many rows long', () => {
    const data = bytesOf(SNAPSHOT_CHUNK_BYTES * 2 + 4096);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(3);
    expect(joinChunks(chunks)).toEqual(data);
    // Every row but the last is a full row: this is what keeps a board's rows from
    // being an endless tail of scraps.
    expect(chunks.slice(0, 2).every((chunk) => chunk.byteLength === SNAPSHOT_CHUNK_BYTES)).toBe(true);
  });

  it('leaves the rows alone once they are cut, even if the snapshot is used again', () => {
    const data = bytesOf(SNAPSHOT_CHUNK_BYTES + 8);
    const chunks = chunkBytes(data);
    // Byte 5 is not zero before this, and is not zero after it: the rows are copies, so
    // whatever happens to the snapshot's bytes cannot reach the rows that were cut from
    // it — which matters because a snapshot is encoded once and written over time.
    expect(data[5]).not.toBe(0);
    data.fill(0);
    expect(joinChunks(chunks).byteLength).toBe(SNAPSHOT_CHUNK_BYTES + 8);
    expect(joinChunks(chunks)[5]).not.toBe(0);
  });

  it('joins nothing into nothing', () => {
    const joined = joinChunks([]);
    expect(joined.byteLength).toBe(0);
    expect(joined).toBeInstanceOf(Uint8Array);
  });
});

describe('deciding when the log is long enough to fold away (TC-02)', () => {
  it('says no below the count, and yes at it', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('says no below the bytes, and yes at them', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('is moved by either half on its own, and by neither', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, 0)).toBe(false);
    // Past the boundary it stays yes: a log that keeps growing is not going to be
    // reconsidered.
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, 0)).toBe(true);
    expect(shouldCompact(0, COMPACTION_BYTES * 3)).toBe(true);
  });
});
