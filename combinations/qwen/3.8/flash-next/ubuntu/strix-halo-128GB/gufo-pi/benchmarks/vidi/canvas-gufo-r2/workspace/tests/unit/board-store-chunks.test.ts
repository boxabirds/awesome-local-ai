/**
 * TC-01: chunkBytes / joinChunks round trip and edge cases.
 * TC-02: shouldCompact thresholds.
 */
import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';

function bytes(length: number, seed = 0): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = (i + seed) % 251;
  return out;
}

describe('chunkBytes', () => {
  // TC-01: empty input → no chunks
  it('returns no chunks for zero bytes', () => {
    expect(chunkBytes(new Uint8Array(0), 64)).toEqual([]);
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
  });

  // TC-01: smaller than size → one chunk equal to the input
  it('returns one chunk when input is smaller than the size', () => {
    const data = bytes(10, 3);
    const chunks = chunkBytes(data, 64);
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0])).toEqual(Array.from(data));
  });

  // TC-01: exactly size → one chunk
  it('returns one chunk when input is exactly the size', () => {
    const data = bytes(64);
    const chunks = chunkBytes(data, 64);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(64);
  });

  // TC-01: size + 1 → two chunks, last one partial
  it('splits at size + 1 with a partial last chunk', () => {
    const data = bytes(65, 7);
    const chunks = chunkBytes(data, 64);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(64);
    expect(chunks[1]).toHaveLength(1);
  });

  // TC-01: multi-MB input at the configured chunk size round-trips
  it('round-trips a multi-megabyte input through joinChunks at the default size', () => {
    const data = bytes(3 * SNAPSHOT_CHUNK_BYTES + 1234, 11);
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(4);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(data));
  });

  // TC-01: chunks concatenate back to the exact input for several shapes
  it('round-trips empty, single and many-chunk inputs', () => {
    for (const length of [0, 1, 63, 64, 65, 256, 1000]) {
      const data = bytes(length, length);
      expect(Array.from(joinChunks(chunkBytes(data, 64)))).toEqual(Array.from(data));
    }
  });

  // TC-01: joinChunks of no chunks is empty
  it('joinChunks of an empty list is a zero-length array', () => {
    expect(joinChunks([])).toHaveLength(0);
  });
});

describe('shouldCompact', () => {
  // TC-02: below both thresholds → false
  it('is false below both thresholds', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });

  // TC-02: count at threshold → true
  it('is true at the row-count threshold', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  // TC-02: bytes at threshold → true
  it('is true at the byte threshold', () => {
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });

  // TC-02: above either threshold → true
  it('is true above either threshold', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 40, 10)).toBe(true);
    expect(shouldCompact(2, COMPACTION_BYTES + 1024)).toBe(true);
  });
});
