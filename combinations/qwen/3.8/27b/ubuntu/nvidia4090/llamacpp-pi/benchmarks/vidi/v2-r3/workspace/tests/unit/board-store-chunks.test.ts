import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

/** Deterministic, byte-varied filler so chunk boundaries are observable. */
function bytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + 13) & 0xff;
  return out;
}

describe('chunkBytes / joinChunks (TC-01)', () => {
  it('0 bytes produces 0 chunks', () => {
    expect(chunkBytes(bytes(0))).toEqual([]);
  });

  it('1 byte produces 1 chunk of 1 byte', () => {
    const chunks = chunkBytes(bytes(1));
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0])).toEqual([13]);
  });

  it('exactly SNAPSHOT_CHUNK_BYTES produces 1 chunk', () => {
    const chunks = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(SNAPSHOT_CHUNK_BYTES);
  });

  it('SNAPSHOT_CHUNK_BYTES + 1 produces 2 chunks (last holds the 1 spare byte)', () => {
    const chunks = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1]).toHaveLength(1);
  });

  it('honours an explicit chunk size', () => {
    const chunks = chunkBytes(bytes(10), 4);
    expect(chunks.map((c) => c.length)).toEqual([4, 4, 2]);
  });

  it('joinChunks round-trips every boundary case byte-identical', () => {
    for (const n of [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1]) {
      const data = bytes(n);
      expect(Array.from(joinChunks(chunkBytes(data)))).toEqual(Array.from(data));
    }
  });
});

describe('shouldCompact (TC-02)', () => {
  it('count boundary: one below is false, exactly is true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('bytes boundary: one below is false, exactly is true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('either threshold alone is enough; neither together is not', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true);
  });
});
