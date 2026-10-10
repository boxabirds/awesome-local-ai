import { describe, expect, it } from 'vitest';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

describe('chunkBytes / joinChunks (TC-01)', () => {
  const size = SNAPSHOT_CHUNK_BYTES;

  const cases: Array<[string, number, number]> = [
    ['0 bytes', 0, 0],
    ['1 byte', 1, 1],
    ['exactly SNAPSHOT_CHUNK_BYTES', size, 1],
    ['SNAPSHOT_CHUNK_BYTES + 1', size + 1, 2]
  ];

  for (const [label, length, expectedChunks] of cases) {
    it(`chunks ${label} into ${expectedChunks} chunks and round-trips byte-identical`, () => {
      const data = new Uint8Array(length);
      for (let i = 0; i < length; i += 1) data[i] = (i * 31 + 7) & 0xff;
      const chunks = chunkBytes(data);
      expect(chunks.length).toBe(expectedChunks);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(size);
      }
      expect(joinChunks(chunks)).toEqual(data);
    });
  }

  it('joins zero chunks to an empty array', () => {
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });

  it('rejects a chunk size below 1', () => {
    expect(() => chunkBytes(new Uint8Array(4), 0)).toThrow(RangeError);
  });
});

describe('shouldCompact (TC-02)', () => {
  it('is false below both thresholds', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('is true at exactly COMPACTION_UPDATE_COUNT rows', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('is true at exactly COMPACTION_BYTES bytes', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('is true above the thresholds', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, COMPACTION_BYTES + 1)).toBe(true);
  });
});
