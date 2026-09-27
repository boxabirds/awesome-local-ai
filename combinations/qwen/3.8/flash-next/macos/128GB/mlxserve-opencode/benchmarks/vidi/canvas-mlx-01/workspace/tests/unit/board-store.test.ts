/**
 * Unit tests for the pure logic behind `persist.board_store`: snapshot chunking
 * round-trip and the compaction threshold decision (TC-01, TC-02).
 */
import { describe, expect, it } from 'vitest';
import {
  chunkBytes,
  joinChunks,
  shouldCompact,
} from '../../src/worker/board-store-chunks.js';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config.js';

const bytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe('chunkBytes / joinChunks (TC-01)', () => {
  it('0 bytes -> 0 chunks; join of zero chunks is empty', () => {
    expect(chunkBytes(bytes(0))).toHaveLength(0);
    expect(joinChunks(chunkBytes(bytes(0))).byteLength).toBe(0);
  });

  it('1 byte -> 1 chunk', () => {
    const c = chunkBytes(bytes(1));
    expect(c).toHaveLength(1);
    expect(c[0]!.byteLength).toBe(1);
  });

  it('SNAPSHOT_CHUNK_BYTES -> exactly 1 chunk (boundary)', () => {
    const c = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES));
    expect(c).toHaveLength(1);
  });

  it('SNAPSHOT_CHUNK_BYTES + 1 -> 2 chunks (boundary)', () => {
    const c = chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1));
    expect(c).toHaveLength(2);
    expect(c[0]!.byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
    expect(c[1]!.byteLength).toBe(1);
  });

  it('join round-trips byte-identically across a range of sizes', () => {
    for (const n of [0, 1, 2, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 2 + 5]) {
      const data = bytes(n);
      const joined = joinChunks(chunkBytes(data));
      expect(Array.from(joined)).toEqual(Array.from(data));
    }
  });

  it('honours an explicit size argument', () => {
    const c = chunkBytes(bytes(10), 4);
    expect(c.map((x) => x.byteLength)).toEqual([4, 4, 2]);
  });
});

describe('shouldCompact (TC-02)', () => {
  it('count COMPACTION_UPDATE_COUNT - 1 -> false; exactly -> true', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('bytes COMPACTION_BYTES - 1 -> false; exactly -> true', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('either threshold alone triggers compaction', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES - 1)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES)).toBe(true);
  });
});
