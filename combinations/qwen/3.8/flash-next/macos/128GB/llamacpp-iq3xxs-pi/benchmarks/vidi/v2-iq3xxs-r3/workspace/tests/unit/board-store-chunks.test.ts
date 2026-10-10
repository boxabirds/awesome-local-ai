/**
 * TC-01 and TC-02 (persist.board_store) — the two pure functions behind the
 * storage layout: how a snapshot is cut into rows, and when the update log is
 * folded back into one.
 *
 * Both are tested at their boundaries because both decide how much work
 * opening a board costs: one chunk too big is a row SQLite refuses, one row
 * too many in the log is a board that opens slowly.
 */
import { describe, expect, it } from 'vitest';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

/** `size` bytes with a recognisable pattern, so a wrong slice is visible. */
function bytes(size: number, seed = 7): Uint8Array {
  const out = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) out[index] = (index * seed + 3) % 251;
  return out;
}

const equal = (a: Uint8Array, b: Uint8Array): boolean =>
  a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);

describe('chunkBytes / joinChunks (TC-01)', () => {
  it('cuts 0, 1, exactly one chunk, and one byte more into 0, 1, 1, 2 chunks', () => {
    const cases = [
      { size: 0, chunks: 0 },
      { size: 1, chunks: 1 },
      { size: SNAPSHOT_CHUNK_BYTES, chunks: 1 },
      { size: SNAPSHOT_CHUNK_BYTES + 1, chunks: 2 },
      { size: SNAPSHOT_CHUNK_BYTES * 2 + 40, chunks: 3 },
    ] as const;

    for (const { size, chunks } of cases) {
      const data = bytes(size);
      const cut = chunkBytes(data);
      expect(cut, `size ${size}`).toHaveLength(chunks);
      // Every chunk except the last is full, and the last carries the rest.
      let seen = 0;
      cut.forEach((chunk, index) => {
        const expected = index === cut.length - 1 ? size - seen : SNAPSHOT_CHUNK_BYTES;
        expect(chunk.byteLength, `size ${size}, chunk ${index}`).toBe(expected);
        seen += chunk.byteLength;
      });
      expect(seen).toBe(size);
    }
  });

  it('joins the pieces back into byte-identical input', () => {
    for (const size of [0, 1, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1]) {
      const data = bytes(size, 11);
      const joined = joinChunks(chunkBytes(data));
      expect(equal(joined, data), `size ${size}`).toBe(true);
    }
  });

  it('does not share a buffer with the input, so a chunk can outlive it', () => {
    const data = bytes(SNAPSHOT_CHUNK_BYTES + 5);
    const [first] = chunkBytes(data);
    if (!first) throw new Error('expected at least one chunk');
    first[0] = (first[0] + 1) % 251;
    expect(data[0]).not.toBe(first[0]);
  });

  it('honours a chunk size given by the caller', () => {
    expect(chunkBytes(bytes(10), 4).map((chunk) => chunk.byteLength)).toEqual([4, 4, 2]);
  });
});

describe('shouldCompact (TC-02)', () => {
  it('turns true exactly at COMPACTION_UPDATE_COUNT rows', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('turns true exactly at COMPACTION_BYTES of logged updates', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('is false below both thresholds and true when either is reached', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES - 1)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES)).toBe(true);
  });
});
