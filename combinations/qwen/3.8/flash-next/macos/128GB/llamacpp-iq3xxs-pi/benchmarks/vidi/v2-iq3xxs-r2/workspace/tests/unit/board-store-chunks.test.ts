import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

/**
 * TC-01, TC-02 (design "Board storage", unit scope): the pure maths behind compaction,
 * in isolation. Everything about these calls is byte arrays and thresholds — the real
 * SQLite behaviour lives in `tests/integration/board-store.test.ts`.
 */

function bytes(length: number, seed = 0): Uint8Array {
  const data = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) data[i] = (i + seed) % 251;
  return data;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe('chunkBytes / joinChunks (TC-01)', () => {
  // The design's boundary values: 0, 1, exactly one chunk, one byte past it.
  const lengths = [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1];
  const expectedChunks = [0, 1, 1, 2];

  lengths.forEach((length, index) => {
    it(`TC-01 ${length} byte(s) chunk to ${expectedChunks[index]} chunk(s) and join back identical`, () => {
      const data = bytes(length);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(expectedChunks[index]);
      for (const chunk of chunks) {
        expect(chunk.length).toBeGreaterThan(0);
        expect(chunk.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }
      // Round trip, byte for byte, in chunk order.
      expect(Array.from(joinChunks(chunks))).toEqual(Array.from(data));
    });
  });

  it('TC-01 splits one byte past the chunk size into a full chunk plus a remainder', () => {
    const data = bytes(SNAPSHOT_CHUNK_BYTES + 1, 7);
    const chunks = chunkBytes(data);
    expect(chunks.map((chunk) => chunk.length)).toEqual([
      SNAPSHOT_CHUNK_BYTES,
      1,
    ]);
    expect(joinChunks(chunks).length).toBe(data.length);
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(data));
  });

  it('TC-01 joinChunks of no chunks is the empty state, not null or a crash', () => {
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });

  it('TC-01 honours an explicit chunk size (the parameter exists for the threshold tests)', () => {
    const data = bytes(10);
    expect(chunkBytes(data, 4).map((chunk) => chunk.length)).toEqual([4, 4, 2]);
    expect(chunkBytes(data, 10)).toHaveLength(1);
    expect(chunkBytes(bytes(0), 4)).toHaveLength(0);
  });
});

describe('shouldCompact (TC-02)', () => {
  it('TC-02 triggers exactly at COMPACTION_UPDATE_COUNT rows, not one before', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('TC-02 triggers exactly at COMPACTION_BYTES, not one byte before', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('TC-02 stays false below both thresholds', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, 0)).toBe(false);
  });
});
