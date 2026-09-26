import { describe, it, expect } from 'vitest';

import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';

/**
 * persist.board_store unit tests (TC-01, TC-02): the pure maths behind
 * compaction, exercised in isolation from any storage engine.
 */

describe('chunkBytes / joinChunks (TC-01)', () => {
  const bytes = (length: number): Uint8Array =>
    Uint8Array.from({ length }, (_unused, index) => index % 251);

  const cases: Array<[string, number, number]> = [
    ['0 bytes', 0, 0],
    ['1 byte', 1, 1],
    ['exactly SNAPSHOT_CHUNK_BYTES', SNAPSHOT_CHUNK_BYTES, 1],
    ['SNAPSHOT_CHUNK_BYTES + 1', SNAPSHOT_CHUNK_BYTES + 1, 2],
  ];

  it.each(cases)('chunk(%s) produces %i chunk(s)', (_name, length, expected) => {
    const chunks = chunkBytes(bytes(length));
    expect(chunks).toHaveLength(expected);
    expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(length);
    for (const chunk of chunks.slice(0, -1)) {
      expect(chunk.byteLength).toBe(SNAPSHOT_CHUNK_BYTES);
    }
  });

  it('joinChunks round-trips byte for byte at every boundary', () => {
    for (const length of [0, 1, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, 3 * SNAPSHOT_CHUNK_BYTES + 7]) {
      const data = bytes(length);
      const joined = joinChunks(chunkBytes(data));
      expect(Array.from(joined)).toEqual(Array.from(data));
    }
  });

  it('an explicit size splits at that size', () => {
    const chunks = chunkBytes(bytes(10), 4);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([4, 4, 2]);
  });
});

describe('shouldCompact (TC-02)', () => {
  it('fires exactly at COMPACTION_UPDATE_COUNT rows', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('fires exactly at COMPACTION_BYTES', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('stays quiet below both thresholds', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });
});
