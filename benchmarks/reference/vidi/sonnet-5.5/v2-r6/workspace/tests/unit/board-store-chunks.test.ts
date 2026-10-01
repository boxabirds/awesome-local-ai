import { describe, expect, it } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

describe('TC-01: chunkBytes / joinChunks', () => {
  const cases: [number, number][] = [
    [0, 0], [1, 1], [SNAPSHOT_CHUNK_BYTES, 1], [SNAPSHOT_CHUNK_BYTES + 1, 2],
  ];
  for (const [size, expected] of cases) {
    it(`${size} bytes -> ${expected} chunk(s), round-trips`, () => {
      const data = Uint8Array.from({ length: size }, (_, i) => i % 251);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(expected);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      expect(joinChunks(chunks)).toEqual(data);
    });
  }
});

describe('TC-02: shouldCompact', () => {
  it('count boundary', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });
  it('bytes boundary', () => {
    expect(shouldCompact(1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });
});
