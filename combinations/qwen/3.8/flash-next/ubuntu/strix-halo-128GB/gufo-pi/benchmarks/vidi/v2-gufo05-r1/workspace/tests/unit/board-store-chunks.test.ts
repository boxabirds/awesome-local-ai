/**
 * The arithmetic behind compaction, on its own.
 *
 * `chunkBytes` and `shouldCompact` decide when a board is folded into a snapshot
 * and how that snapshot is cut into rows, so their boundary values are the values
 * the storage is sized for: a chunk that is one byte too big is a row the platform
 * refuses, and a threshold that fires one update early or late is a replay that is
 * one update longer than the design allows. The rest of `BoardStore` — the SQL — is
 * tested against real Durable Object storage in
 * `tests/integration/board-store.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

/** Bytes that say where they came from, so a reassembly cannot pass by accident. */
function pattern(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = index % 251;
  return bytes;
}

describe('chunkBytes and joinChunks (TC-01)', () => {
  const cases: { name: string; length: number; chunks: number }[] = [
    { name: 'no bytes', length: 0, chunks: 0 },
    { name: 'one byte', length: 1, chunks: 1 },
    { name: 'exactly one chunk', length: SNAPSHOT_CHUNK_BYTES, chunks: 1 },
    { name: 'one byte over a chunk', length: SNAPSHOT_CHUNK_BYTES + 1, chunks: 2 },
  ];

  for (const testCase of cases) {
    it(`splits ${testCase.name} into ${String(testCase.chunks)} chunk(s) and rejoins them`, () => {
      const data = pattern(testCase.length);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(testCase.chunks);
      // Reassembly is byte-identical, in order, with nothing doubled or dropped.
      expect(joinChunks(chunks)).toEqual(data);
    });
  }

  it('produces no empty chunk and never one larger than the size', () => {
    for (const length of [0, 1, 7, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, SNAPSHOT_CHUNK_BYTES * 3 + 5]) {
      const chunks = chunkBytes(pattern(length));
      expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(length);
      for (const chunk of chunks) {
        expect(chunk.byteLength).toBeGreaterThan(0);
        expect(chunk.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }
    }
  });

  it('honours an explicit chunk size', () => {
    const data = pattern(10);
    const chunks = chunkBytes(data, 4);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([4, 4, 2]);
    expect(joinChunks(chunks)).toEqual(data);
  });

  it('joins no chunks into no bytes', () => {
    expect(joinChunks([])).toEqual(new Uint8Array());
  });
});

describe('shouldCompact (TC-02)', () => {
  it('reaches the row threshold exactly', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('reaches the byte threshold exactly', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('says no to an empty and a small log', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(1, 12)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });
});
