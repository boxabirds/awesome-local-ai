/**
 * TC-01 / TC-02: the two arithmetic functions of `persist.board_store`, tested on their own.
 *
 * Chunking decides how a snapshot is laid out in rows and the threshold decides when the log
 * is worth folding up; both are pure byte-and-number maths, so they are tested here as maths
 * and again against real SQLite in `tests/integration/board-store.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  chunkBytes,
  joinChunks,
  shouldCompact,
} from '../../../src/worker/board-store';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../../src/shared/config';

/** `size` bytes of recognisable data, so a round-trip can be compared byte by byte. */
function bytes(size: number): Uint8Array {
  const data = new Uint8Array(size);
  for (let index = 0; index < size; index += 1) {
    data[index] = index % 251;
  }
  return data;
}

function sizes(chunks: Uint8Array[]): number[] {
  return chunks.map((chunk) => chunk.byteLength);
}

describe('TC-01 chunkBytes splits, joinChunks puts back', () => {
  it('makes no chunk out of nothing', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
  });

  it('makes one chunk out of one byte', () => {
    expect(chunkBytes(bytes(1))).toHaveLength(1);
  });

  it('makes exactly one chunk out of exactly one chunk-size of bytes', () => {
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES))).toEqual([bytes(SNAPSHOT_CHUNK_BYTES)]);
  });

  it('makes two chunks out of one byte more than a chunk', () => {
    const data = bytes(SNAPSHOT_CHUNK_BYTES + 1);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(2);
    expect(sizes(chunks)).toEqual([SNAPSHOT_CHUNK_BYTES, 1]);
  });

  it('keeps the order and the bytes of every chunk it made', () => {
    const data = bytes(SNAPSHOT_CHUNK_BYTES * 2 + 500);
    const chunks = chunkBytes(data);
    expect(chunks).toHaveLength(3);
    expect(sizes(chunks)).toEqual([SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES, 500]);
    expect(joinChunks(chunks)).toEqual(data);
  });

  it('round-trips whatever size it is asked to cut at', () => {
    for (const size of [1, 2, 3, 7, 8, 64]) {
      for (const length of [0, 1, 2, 5, 100]) {
        const data = bytes(length);
        const chunks = chunkBytes(data, size);
        expect(chunks.every((chunk) => chunk.byteLength <= size)).toBe(true);
        expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(length);
        expect(joinChunks(chunks)).toEqual(data);
      }
    }
  });

  it('joins nothing into nothing', () => {
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });
});

describe('TC-02 shouldCompact at the two thresholds', () => {
  it('leaves a log one row short of the row threshold alone', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 1)).toBe(false);
  });

  it('folds a log that reaches the row threshold', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 1)).toBe(true);
  });

  it('leaves a log one byte short of the byte threshold alone', () => {
    expect(shouldCompact(1, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('folds a log that reaches the byte threshold', () => {
    expect(shouldCompact(1, COMPACTION_BYTES)).toBe(true);
  });

  it('says nothing is worth folding about an empty log', () => {
    expect(shouldCompact(0, 0)).toBe(false);
  });
});
