import { describe, expect, it } from 'vitest';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

/** Deterministic, non-repeating bytes so a misplaced slice is detected. */
function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = 0x9e3779b9;
  for (let i = 0; i < length; i += 1) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    out[i] = x & 0xff;
  }
  return out;
}

describe('persist.board_store chunking (TC-01)', () => {
  const cases: [string, number, number][] = [
    ['0 bytes', 0, 0],
    ['1 byte', 1, 1],
    ['exactly SNAPSHOT_CHUNK_BYTES', SNAPSHOT_CHUNK_BYTES, 1],
    ['SNAPSHOT_CHUNK_BYTES + 1', SNAPSHOT_CHUNK_BYTES + 1, 2],
  ];
  for (const [name, length, expected] of cases) {
    it(`${name} → ${expected} chunk(s), each ≤ SNAPSHOT_CHUNK_BYTES, joined byte-identical`, () => {
      const data = bytes(length);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(expected);
      for (const c of chunks) expect(c.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      expect(joinChunks(chunks)).toEqual(data);
    });
  }

  it('honours an explicit chunk size', () => {
    const data = bytes(10);
    expect(chunkBytes(data, 4).map((c) => c.byteLength)).toEqual([4, 4, 2]);
    expect(joinChunks(chunkBytes(data, 4))).toEqual(data);
  });

  it('joinChunks of no chunks is empty', () => {
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });
});

describe('persist.board_store compaction threshold (TC-02)', () => {
  it('count COMPACTION_UPDATE_COUNT - 1 → false, exactly → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });
  it('bytes COMPACTION_BYTES - 1 → false, exactly → true', () => {
    expect(shouldCompact(1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });
  it('an empty log never compacts', () => {
    expect(shouldCompact(0, 0)).toBe(false);
  });
});
