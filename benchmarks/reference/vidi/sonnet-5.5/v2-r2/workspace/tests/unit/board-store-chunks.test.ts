import { describe, expect, it } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/chunking';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe('chunkBytes / joinChunks (TC-01)', () => {
  const cases: [string, number, number][] = [
    ['0 bytes', 0, 0],
    ['1 byte', 1, 1],
    ['exactly SNAPSHOT_CHUNK_BYTES', SNAPSHOT_CHUNK_BYTES, 1],
    ['SNAPSHOT_CHUNK_BYTES + 1', SNAPSHOT_CHUNK_BYTES + 1, 2],
  ];
  for (const [name, size, count] of cases) {
    it(`${name} -> ${count} chunk(s), join is identical`, () => {
      const data = bytes(size);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(count);
      expect(chunks.every((c) => c.length <= SNAPSHOT_CHUNK_BYTES)).toBe(true);
      expect(joinChunks(chunks)).toEqual(data);
    });
  }
});

describe('shouldCompact (TC-02)', () => {
  it('count boundary', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });
  it('bytes boundary', () => {
    expect(shouldCompact(1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });
});
