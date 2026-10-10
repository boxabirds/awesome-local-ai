import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

/**
 * TC-01 and TC-02 (anchor `persist.board_store`).
 *
 * The two pure decisions the storage layer makes on its own: how a snapshot is
 * cut into rows, and when the update log is big enough to be compacted. Both
 * are tested at their exact boundaries, because a chunk that is too large
 * exceeds the platform's per-row limit and a threshold that is off by one either
 * replays an unbounded log or compacts needlessly.
 */

/** Deterministic pseudo-random bytes, so a round-trip proves ordering too. */
function bytesOf(length: number, seed = 7): Uint8Array {
  const data = new Uint8Array(length);
  let state = seed;
  for (let index = 0; index < length; index += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    data[index] = state % 256;
  }
  return data;
}

const equalBytes = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && a.every((byte, index) => byte === b[index]);

const isPlainUint8 = (value: Uint8Array): boolean =>
  value instanceof Uint8Array && value.byteOffset === 0 && value.byteLength === value.buffer.byteLength;

describe('snapshot chunking (persist.board_store)', () => {
  it('TC-01: 0, 1, SNAPSHOT_CHUNK_BYTES and SNAPSHOT_CHUNK_BYTES + 1 bytes produce 0, 1, 1 and 2 chunks', () => {
    const cases: Array<{ length: number; chunks: number }> = [
      { length: 0, chunks: 0 },
      { length: 1, chunks: 1 },
      { length: SNAPSHOT_CHUNK_BYTES, chunks: 1 },
      { length: SNAPSHOT_CHUNK_BYTES + 1, chunks: 2 },
    ];
    for (const { length, chunks } of cases) {
      const data = bytesOf(length);
      const produced = chunkBytes(data);
      expect(produced.length, `length ${length}`).toBe(chunks);
      // No chunk may ever exceed the size the schema was designed around.
      for (const chunk of produced) {
        expect(chunk.byteLength).toBeGreaterThan(0);
        expect(chunk.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }
    }
  });

  it('TC-01: joinChunks round-trips every chunk boundary byte-identically', () => {
    for (const length of [
      0,
      1,
      2,
      SNAPSHOT_CHUNK_BYTES - 1,
      SNAPSHOT_CHUNK_BYTES,
      SNAPSHOT_CHUNK_BYTES + 1,
      2 * SNAPSHOT_CHUNK_BYTES,
      2 * SNAPSHOT_CHUNK_BYTES + 1,
      3 * SNAPSHOT_CHUNK_BYTES - 1,
    ]) {
      const data = bytesOf(length);
      const joined = joinChunks(chunkBytes(data));
      expect(equalBytes(joined, data), `length ${length}`).toBe(true);
      expect(joined.byteLength).toBe(length);
      // Own buffer, not a view: rows are handed to Yjs and to SQLite as blobs.
      expect(isPlainUint8(joined)).toBe(true);
    }
  });

  it('TC-01: chunks are independent copies of the source, in order', () => {
    const data = bytesOf(2 * SNAPSHOT_CHUNK_BYTES + 5);
    const produced = chunkBytes(data);
    expect(produced.map((chunk) => chunk.byteLength)).toEqual([
      SNAPSHOT_CHUNK_BYTES,
      SNAPSHOT_CHUNK_BYTES,
      5,
    ]);
    let offset = 0;
    for (const chunk of produced) {
      for (let index = 0; index < chunk.byteLength; index += 1) {
        expect(chunk[index]).toBe(data[offset + index]);
      }
      offset += chunk.byteLength;
    }
  });

  it('TC-01: an explicit size is honoured (chunking is not hard-wired to one number)', () => {
    const produced = chunkBytes(bytesOf(10), 4);
    expect(produced.map((chunk) => chunk.byteLength)).toEqual([4, 4, 2]);
    expect(joinChunks(produced).byteLength).toBe(10);
  });
});

describe('compaction threshold (persist.board_store)', () => {
  it('TC-02: the row-count threshold flips at COMPACTION_UPDATE_COUNT, not before', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('TC-02: the byte threshold flips at COMPACTION_BYTES, not before', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('TC-02: either threshold alone is enough; an empty log is never compacted', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES - 1)).toBe(true);
    expect(shouldCompact(0, 0)).toBe(false);
  });
});
