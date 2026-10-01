import { describe, expect, it } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

describe('chunkBytes / joinChunks (TC-01)', () => {
  const cases: Array<[number, number]> = [
    [0, 0], [1, 1], [SNAPSHOT_CHUNK_BYTES, 1], [SNAPSHOT_CHUNK_BYTES + 1, 2],
  ];
  for (const [size, expectedChunks] of cases) {
    it(`${size} bytes → ${expectedChunks} chunk(s), joined byte-identical`, () => {
      const data = new Uint8Array(size).map((_, i) => i % 251);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(expectedChunks);
      expect(chunks.every((c) => c.length <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
      expect(joinChunks(chunks)).toEqual(data);
    });
  }
});

describe('shouldCompact (TC-02)', () => {
  it('count threshold: COMPACTION_UPDATE_COUNT - 1 false, exactly true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });
  it('byte threshold: COMPACTION_BYTES - 1 false, exactly true', () => {
    expect(shouldCompact(1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });
});
