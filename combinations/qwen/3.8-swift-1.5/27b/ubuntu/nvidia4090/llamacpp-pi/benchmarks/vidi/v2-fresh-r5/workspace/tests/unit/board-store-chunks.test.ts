/**
 * Unit tests for persist.board_store pure chunking/threshold logic
 * (TC-01 chunkBytes/joinChunks, TC-02 shouldCompact).
 */
import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';

function bytes(n: number, fill = 0xab): Uint8Array {
  const d = new Uint8Array(n);
  for (let i = 0; i < n; i++) d[i] = fill ^ (i % 7);
  return d;
}

describe('persist.board_store chunking (TC-01)', () => {
  it('chunks 0 bytes into 0 chunks', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
  });

  it('chunks 1 byte into 1 chunk', () => {
    const chunks = chunkBytes(bytes(1));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(bytes(1));
  });

  it('chunks exactly SNAPSHOT_CHUNK_BYTES into 1 chunk', () => {
    const data = bytes(SNAPSHOT_CHUNK_BYTES);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
  });

  it('chunks SNAPSHOT_CHUNK_BYTES + 1 into 2 chunks (1 full, 1 of 1 byte)', () => {
    const data = bytes(SNAPSHOT_CHUNK_BYTES + 1);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].length).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(chunks[1].length).toBe(1);
  });

  it('honours an explicit chunk size', () => {
    const chunks = chunkBytes(bytes(10), 3);
    expect(chunks.map((c) => c.length)).toEqual([3, 3, 3, 1]);
  });

  it('joinChunks round-trips byte-identically at the boundaries', () => {
    for (const n of [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1]) {
      const data = bytes(n);
      const joined = joinChunks(chunkBytes(data));
      expect(Array.from(joined)).toEqual(Array.from(data));
    }
  });
});

describe('persist.board_store compaction threshold (TC-02)', () => {
  it('count: COMPACTION_UPDATE_COUNT - 1 rows does not compact', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it('count: exactly COMPACTION_UPDATE_COUNT rows compacts', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('bytes: COMPACTION_BYTES - 1 does not compact', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('bytes: exactly COMPACTION_BYTES compacts', () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('below both thresholds does not compact', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });
});
