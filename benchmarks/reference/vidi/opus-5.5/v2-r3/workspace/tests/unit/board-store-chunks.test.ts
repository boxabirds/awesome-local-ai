import { describe, expect, it } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

function bytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}

describe('chunkBytes / joinChunks (persist.board_store)', () => {
  const cases: [number, number][] = [
    [0, 0],
    [1, 1],
    [SNAPSHOT_CHUNK_BYTES, 1],
    [SNAPSHOT_CHUNK_BYTES + 1, 2],
  ];
  for (const [size, expected] of cases) {
    it(`TC-01: ${size} bytes → ${expected} chunk(s); join round-trips byte-identical`, () => {
      const data = bytes(size);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(expected);
      for (const c of chunks) expect(c.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      const joined = joinChunks(chunks);
      expect(joined.byteLength).toBe(size);
      expect(Buffer.from(joined).equals(Buffer.from(data))).toBe(true);
    });
  }

  it('TC-01: the last chunk holds the remainder', () => {
    const chunks = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1));
    expect(chunks.map((c) => c.byteLength)).toEqual([SNAPSHOT_CHUNK_BYTES, 1]);
  });

  it('TC-01: honours an explicit size', () => {
    expect(chunkBytes(bytes(10), 3).map((c) => c.byteLength)).toEqual([3, 3, 3, 1]);
  });
});

describe('shouldCompact (persist.board_store)', () => {
  it('TC-02: count threshold COMPACTION_UPDATE_COUNT − 1 / exactly', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('TC-02: byte threshold COMPACTION_BYTES − 1 / exactly', () => {
    expect(shouldCompact(1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });
});
