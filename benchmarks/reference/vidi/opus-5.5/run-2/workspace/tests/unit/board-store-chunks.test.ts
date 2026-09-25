import { describe, expect, it } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i * 31 + 7) % 256;
  return out;
}

describe('chunkBytes / joinChunks (persist.board_store)', () => {
  const cases: [string, number, number][] = [
    ['0 bytes', 0, 0],
    ['1 byte', 1, 1],
    ['exactly SNAPSHOT_CHUNK_BYTES', SNAPSHOT_CHUNK_BYTES, 1],
    ['SNAPSHOT_CHUNK_BYTES + 1', SNAPSHOT_CHUNK_BYTES + 1, 2],
  ];
  for (const [name, length, expected] of cases) {
    it(`TC-01 ${name} → ${expected} chunk(s), join round-trips`, () => {
      const data = bytes(length);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(expected);
      for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      const joined = joinChunks(chunks);
      expect(joined.length).toBe(length);
      expect(joined.every((b, i) => b === data[i])).toBe(true);
    });
  }

  it('TC-01 honours an explicit chunk size', () => {
    expect(chunkBytes(bytes(10), 3).map((c) => c.length)).toEqual([3, 3, 3, 1]);
  });
});

describe('shouldCompact (persist.board_store)', () => {
  it('TC-02 by row count', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('TC-02 by bytes', () => {
    expect(shouldCompact(1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });
});
