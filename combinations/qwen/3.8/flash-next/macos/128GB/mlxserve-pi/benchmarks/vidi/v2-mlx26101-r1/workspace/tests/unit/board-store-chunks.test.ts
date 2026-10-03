// persist.board_store — the pure byte logic behind storage: snapshot chunking and
// the compaction threshold. No SQLite here; the real engine is exercised by the
// integration suite. These are the boundary values from the design.

import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

/** A byte array of `length` whose i-th byte is i mod 251 (so joins are checkable). */
function bytesOf(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 251;
  return out;
}

describe('chunkBytes / joinChunks (TC-01)', () => {
  it('produces 0, 1, 1, 2 chunks for 0, 1, size and size+1 bytes', () => {
    expect(chunkBytes(bytesOf(0)).length).toBe(0);
    expect(chunkBytes(bytesOf(1)).length).toBe(1);
    expect(chunkBytes(bytesOf(SNAPSHOT_CHUNK_BYTES)).length).toBe(1);
    expect(chunkBytes(bytesOf(SNAPSHOT_CHUNK_BYTES + 1)).length).toBe(2);
  });

  it('round-trips byte-identically for every boundary size', () => {
    for (const length of [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, 5_000]) {
      const data = bytesOf(length);
      const joined = joinChunks(chunkBytes(data));
      expect(Array.from(joined)).toEqual(Array.from(data));
    }
  });

  it('never emits an empty trailing chunk and every chunk is within the size', () => {
    for (const length of [1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, 3 * SNAPSHOT_CHUNK_BYTES]) {
      const chunks = chunkBytes(bytesOf(length));
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(chunk.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }
    }
  });

  it('honours an explicit chunk size', () => {
    const chunks = chunkBytes(bytesOf(10), 4);
    expect(chunks.map((c) => c.length)).toEqual([4, 4, 2]);
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(bytesOf(10)));
  });
});

describe('shouldCompact (TC-02)', () => {
  it('flips at exactly COMPACTION_UPDATE_COUNT rows', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('flips at exactly COMPACTION_BYTES bytes', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('is below the threshold when both count and bytes are below it', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(
      shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1),
    ).toBe(false);
  });
});
