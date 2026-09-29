// persist.board_store unit tests: chunking maths and the compaction
// threshold in isolation. TC-01, TC-02.

import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

function dataOf(len: number): Uint8Array {
  const data = new Uint8Array(len);
  for (let i = 0; i < len; i++) data[i] = (i * 31 + 7) & 0xff;
  return data;
}

describe('persist.board_store — chunking (TC-01)', () => {
  it('chunk boundaries: 0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1 bytes', () => {
    expect(chunkBytes(new Uint8Array(0))).toHaveLength(0);
    expect(chunkBytes(new Uint8Array(1))).toHaveLength(1);
    expect(chunkBytes(new Uint8Array(SNAPSHOT_CHUNK_BYTES))).toHaveLength(1);
    expect(chunkBytes(new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1))).toHaveLength(2);
  });

  it('chunks are contiguous slices of the input (sizes and content)', () => {
    const len = 3 * SNAPSHOT_CHUNK_BYTES + 7;
    const data = dataOf(len);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(4);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[2].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[3].length).toBe(7);
    expect(Array.from(chunks[3])).toEqual(Array.from(data.subarray(3 * SNAPSHOT_CHUNK_BYTES)));
  });

  it('joinChunks round-trips byte-identical', () => {
    for (const len of [
      0,
      1,
      SNAPSHOT_CHUNK_BYTES - 1,
      SNAPSHOT_CHUNK_BYTES,
      SNAPSHOT_CHUNK_BYTES + 1,
      3 * SNAPSHOT_CHUNK_BYTES + 7,
    ]) {
      const data = dataOf(len);
      expect(Array.from(joinChunks(chunkBytes(data)))).toEqual(Array.from(data));
    }
  });

  it('joinChunks of an empty list is an empty byte array', () => {
    expect(Array.from(joinChunks([]))).toEqual([]);
  });
});

describe('persist.board_store — compaction threshold (TC-02)', () => {
  it('count boundary: COMPACTION_UPDATE_COUNT - 1 / exactly', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('bytes boundary: COMPACTION_BYTES - 1 / exactly', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('either dimension alone triggers compaction', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true);
    expect(shouldCompact(0, 0)).toBe(false);
  });
});
