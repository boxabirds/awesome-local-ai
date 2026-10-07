// TC-01, TC-02: pure storage helpers.
import { describe, expect, it } from 'vitest';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

const CHUNK = SNAPSHOT_CHUNK_BYTES;

function bytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = (i * 31 + 7) % 256;
  return out;
}

function expectSameBytes(a: Uint8Array, b: Uint8Array): void {
  expect(Buffer.compare(Buffer.from(a), Buffer.from(b))).toBe(0);
}

describe('TC-01 snapshot chunking: round trip, boundary', () => {
  it.each([
    ['0 bytes', 0],
    ['1 byte', 1],
    ['exactly one chunk', CHUNK],
    ['one byte over one chunk', CHUNK + 1],
    ['three full chunks', CHUNK * 3],
    ['many chunks with a short tail', CHUNK * 4 + 123_456],
  ])('chunkBytes/joinChunks round-trip a %s snapshot byte-for-byte', (_label, n) => {
    const data = bytes(n);
    const chunks = chunkBytes(data);
    expect(joinChunks(chunks)).toEqual(data);
    expectSameBytes(joinChunks(chunks), data);
  });

  it('splits at the chunk boundary: full chunks are exactly SNAPSHOT_CHUNK_BYTES, the last may be shorter', () => {
    const data = bytes(CHUNK * 2 + 1);
    const chunks = chunkBytes(data);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(CHUNK);
    expect(chunks[1].length).toBe(CHUNK);
    expect(chunks[2].length).toBe(1);
  });

  it('produces zero chunks for an empty snapshot and at most SNAPSHOT_CHUNK_BYTES per chunk', () => {
    expect(chunkBytes(bytes(0)).length).toBe(0);
    const chunks = chunkBytes(bytes(CHUNK + 999));
    expect(chunks.length).toBe(2);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(CHUNK);
  });
});

describe('TC-02 compaction thresholds', () => {
  it('triggers at exactly the update-count threshold', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 10, 0)).toBe(true);
  });

  it('triggers at exactly the byte threshold', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('below both thresholds: no compaction', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });
});
