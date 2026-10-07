import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

/**
 * persist.board_store, pure logic (TC-01, TC-02).
 *
 * The chunking arithmetic and the compaction threshold are functions of bytes and
 * counts, so they are checked here — at their boundaries — before a single SQL row
 * exists anywhere. `chunkBytes`/`joinChunks` must round-trip exactly (the snapshot
 * is only correct if reassembling the chunks reproduces the encoded document byte
 * for byte) and `shouldCompact` must fire on exactly its configured boundary, not a
 * row early or late.
 */

describe('chunkBytes / joinChunks (TC-01)', () => {
  const cases: [label: string, size: number, wantChunks: number][] = [
    ['0 bytes', 0, 0],
    ['1 byte', 1, 1],
    ['exactly SNAPSHOT_CHUNK_BYTES', SNAPSHOT_CHUNK_BYTES, 1],
    ['SNAPSHOT_CHUNK_BYTES + 1', SNAPSHOT_CHUNK_BYTES + 1, 2],
  ];

  for (const [label, size, wantChunks] of cases) {
    it(`chunks ${label} into ${wantChunks} and joins back byte-identical`, () => {
      // Deterministic non-zero content, so a chunk dropped or reordered is caught.
      const data = Uint8Array.from({ length: size }, (_v, i) => (i % 251) + 1);

      const chunks = chunkBytes(data, SNAPSHOT_CHUNK_BYTES);
      expect(chunks).toHaveLength(wantChunks);
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0); // never an empty chunk
        expect(chunk.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }

      const joined = joinChunks(chunks);
      expect(joined.length).toBe(size);
      expect(Array.from(joined)).toEqual(Array.from(data));
    });
  }

  it('defaults the chunk size to SNAPSHOT_CHUNK_BYTES', () => {
    const data = Uint8Array.from({ length: SNAPSHOT_CHUNK_BYTES + 5 }, (_v, i) => i % 200);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(joinChunks(chunks).length).toBe(SNAPSHOT_CHUNK_BYTES + 5);
  });
});

describe('shouldCompact (TC-02)', () => {
  it('fires on exactly COMPACTION_UPDATE_COUNT rows, not one fewer', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('fires on exactly COMPACTION_BYTES, not one fewer', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('is driven by either the row count or the byte total', () => {
    // Below both thresholds: not yet.
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
    // One threshold tripped is enough.
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES - 1)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES)).toBe(true);
  });
});
