import { describe, expect, it } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

function bytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 31 + 7) % 256);
}

describe('persist.board_store chunking (TC-01)', () => {
  it.each([
    [0, 0],
    [1, 1],
    [SNAPSHOT_CHUNK_BYTES, 1],
    [SNAPSHOT_CHUNK_BYTES + 1, 2],
  ])('%i bytes → %i chunks, joined back byte-identical', (length, expected) => {
    const data = bytes(length);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(expected);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    const joined = joinChunks(chunks);
    expect(joined.length).toBe(length);
    expect(Buffer.from(joined).equals(Buffer.from(data))).toBe(true);
  });

  it('the last chunk holds the remainder', () => {
    const chunks = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1));
    expect(chunks.map((c) => c.length)).toEqual([SNAPSHOT_CHUNK_BYTES, 1]);
  });

  it('honours an explicit chunk size and rejects invalid ones', () => {
    expect(chunkBytes(bytes(10), 3).map((c) => c.length)).toEqual([3, 3, 3, 1]);
    expect(() => chunkBytes(bytes(10), 0)).toThrow(RangeError);
    expect(() => chunkBytes(bytes(10), 1.5)).toThrow(RangeError);
  });
});

describe('persist.board_store compaction threshold (TC-02)', () => {
  it('by row count: COMPACTION_UPDATE_COUNT − 1 → false, exactly → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('by bytes: COMPACTION_BYTES − 1 → false, exactly → true', () => {
    expect(shouldCompact(1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });

  it('an empty log never compacts', () => {
    expect(shouldCompact(0, 0)).toBe(false);
  });
});
