/**
 * Board storage unit tests (TC-01, TC-02).
 *
 * The two pieces of arithmetic a snapshot is made of - splitting bytes into rows and
 * deciding when the log is worth folding - are pure, so they are tested here rather than
 * through a database. Both boundaries are the ones that matter: a chunk boundary decides
 * whether a row can grow past the platform's per-row limit, and the compaction threshold
 * decides how much work a board has to do when it wakes up.
 */
import { describe, expect, test } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

/** Bytes 0,1,2,... modulo 256, so a mistake shows up as a difference rather than a match. */
function bytesOf(length: number): Uint8Array {
  const data = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) data[index] = index % 256;
  return data;
}

describe('snapshot chunking (TC-01)', () => {
  test('TC-01: 0, 1, one whole chunk and one chunk plus a byte', () => {
    expect(chunkBytes(bytesOf(0))).toEqual([]);
    expect(chunkBytes(bytesOf(1)).map((chunk) => chunk.length)).toEqual([1]);
    expect(chunkBytes(bytesOf(SNAPSHOT_CHUNK_BYTES)).map((c) => c.length)).toEqual([
      SNAPSHOT_CHUNK_BYTES,
    ]);
    expect(chunkBytes(bytesOf(SNAPSHOT_CHUNK_BYTES + 1)).map((c) => c.length)).toEqual([
      SNAPSHOT_CHUNK_BYTES,
      1,
    ]);
  });

  test('TC-01: no chunk is ever larger than the chunk size', () => {
    for (const length of [0, 1, 7, 64, 65, 129]) {
      const chunks = chunkBytes(bytesOf(length), 64);
      for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(64);
      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      expect(total).toBe(length);
    }
  });

  test('TC-01: joining the chunks returns the input byte for byte', () => {
    for (const length of [0, 1, 5, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1]) {
      const data = bytesOf(length);
      const joined = joinChunks(chunkBytes(data));
      expect(joined.length).toBe(length);
      expect(Array.from(joined)).toEqual(Array.from(data));
    }
  });

  test('joinChunks of nothing is empty, and it copies rather than aliases', () => {
    expect(joinChunks([]).length).toBe(0);
    const source = bytesOf(4);
    const chunk = chunkBytes(source, 4)[0];
    if (!chunk) throw new Error('expected one chunk');
    const joined = joinChunks([chunk]);
    joined[0] = (joined[0] ?? 0) + 1;
    expect(source[0]).toBe(0);
  });
});

describe('the compaction threshold (TC-02)', () => {
  test('TC-02: the row count boundary', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  test('TC-02: the byte boundary', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  test('an empty log is never compacted and either half alone is enough', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES - 1)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES)).toBe(true);
  });
});
