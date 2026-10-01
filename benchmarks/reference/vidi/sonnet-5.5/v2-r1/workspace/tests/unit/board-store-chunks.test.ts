import { describe, expect, it } from 'vitest';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

const bytesOf = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe('TC-01 chunkBytes / joinChunks', () => {
  const cases: [number, number][] = [
    [0, 0],
    [1, 1],
    [SNAPSHOT_CHUNK_BYTES, 1],
    [SNAPSHOT_CHUNK_BYTES + 1, 2],
  ];
  for (const [size, expected] of cases) {
    it(`${size} bytes -> ${expected} chunks, round-trips`, () => {
      const data = bytesOf(size);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(expected);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      expect(joinChunks(chunks)).toEqual(data);
    });
  }

  it('honours an explicit chunk size', () => {
    expect(chunkBytes(bytesOf(10), 4).map((c) => c.length)).toEqual([4, 4, 2]);
  });
});

describe('TC-02 shouldCompact', () => {
  it('count boundary', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });
  it('bytes boundary', () => {
    expect(shouldCompact(1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });
});
