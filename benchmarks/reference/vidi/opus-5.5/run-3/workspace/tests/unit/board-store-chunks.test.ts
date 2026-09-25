import { describe, expect, it } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

function bytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 31 + 7) & 0xff;
  return b;
}

describe('persist.board_store: chunking', () => {
  it.each([
    [0, 0],
    [1, 1],
    [SNAPSHOT_CHUNK_BYTES, 1],
    [SNAPSHOT_CHUNK_BYTES + 1, 2],
  ])('TC-01 %i bytes → %i chunks, joined back byte-identical', (n, expected) => {
    const data = bytes(n);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(expected);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    const joined = joinChunks(chunks);
    expect(joined.length).toBe(n);
    expect(Buffer.from(joined).equals(Buffer.from(data))).toBe(true);
  });

  it('TC-01 a custom chunk size splits exactly', () => {
    const chunks = chunkBytes(bytes(10), 4);
    expect(chunks.map((c) => c.length)).toEqual([4, 4, 2]);
    expect([...joinChunks(chunks)]).toEqual([...bytes(10)]);
  });
});

describe('persist.board_store: compaction threshold', () => {
  it('TC-02 row count: COMPACTION_UPDATE_COUNT - 1 → false, exactly → true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('TC-02 bytes: COMPACTION_BYTES - 1 → false, exactly → true', () => {
    expect(shouldCompact(1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });

  it('TC-02 an empty log never compacts', () => {
    expect(shouldCompact(0, 0)).toBe(false);
  });
});
