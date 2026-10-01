import { describe, expect, it } from 'vitest';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

const bytes = (n: number) => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe('TC-01: chunkBytes / joinChunks', () => {
  it.each([
    [0, 0],
    [1, 1],
    [SNAPSHOT_CHUNK_BYTES, 1],
    [SNAPSHOT_CHUNK_BYTES + 1, 2],
  ])('%i bytes → %i chunks, round-trips byte-identical', (n, chunks) => {
    const data = bytes(n);
    const out = chunkBytes(data);
    expect(out).toHaveLength(chunks);
    for (const c of out) expect(c.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    expect(Array.from(joinChunks(out))).toEqual(Array.from(data));
  });

  it('honours an explicit chunk size', () => {
    expect(chunkBytes(bytes(10), 3).map((c) => c.length)).toEqual([3, 3, 3, 1]);
  });
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
