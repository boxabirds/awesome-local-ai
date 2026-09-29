import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

function bytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + 7) & 0xff;
  return out;
}

describe('persist.board_store chunking', () => {
  it.each([
    [0, 0],
    [1, 1],
    [SNAPSHOT_CHUNK_BYTES, 1],
    [SNAPSHOT_CHUNK_BYTES + 1, 2],
  ])('TC-01 %i bytes → %i chunks that join back byte-identical', (size, expected) => {
    const data = bytes(size);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(expected);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    expect(joinChunks(chunks)).toEqual(data);
  });

  it('TC-01 honours an explicit chunk size', () => {
    const data = bytes(10);
    const chunks = chunkBytes(data, 4);
    expect(chunks.map((c) => c.length)).toEqual([4, 4, 2]);
    expect(joinChunks(chunks)).toEqual(data);
  });
});

describe('persist.board_store compaction threshold', () => {
  it('TC-02 by row count: COMPACTION_UPDATE_COUNT - 1 → false, exactly → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('TC-02 by bytes: COMPACTION_BYTES - 1 → false, exactly → true', () => {
    expect(shouldCompact(1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });
});
