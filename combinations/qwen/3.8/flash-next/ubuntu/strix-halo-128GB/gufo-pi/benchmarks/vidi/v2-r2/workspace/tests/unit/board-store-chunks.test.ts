import { describe, it, expect } from 'vitest';
import {
  chunkBytes,
  joinChunks,
  shouldCompact,
} from '../../src/worker/board-store';
import {
  COMPACTION_UPDATE_COUNT,
  COMPACTION_BYTES,
  SNAPSHOT_CHUNK_BYTES,
} from '@shared/config';

function bytesOf(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = i & 0xff;
  return b;
}

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('TC-01: chunkBytes / joinChunks', () => {
  it('0 bytes -> 0 chunks', () => {
    expect(chunkBytes(bytesOf(0))).toHaveLength(0);
  });

  it('1 byte -> 1 chunk', () => {
    expect(chunkBytes(bytesOf(1))).toHaveLength(1);
  });

  it('SNAPSHOT_CHUNK_BYTES -> 1 chunk', () => {
    expect(chunkBytes(bytesOf(SNAPSHOT_CHUNK_BYTES))).toHaveLength(1);
  });

  it('SNAPSHOT_CHUNK_BYTES + 1 -> 2 chunks', () => {
    expect(chunkBytes(bytesOf(SNAPSHOT_CHUNK_BYTES + 1))).toHaveLength(2);
  });

  it('joinChunks round-trips byte-identically for every boundary size', () => {
    for (const n of [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1, 3 * SNAPSHOT_CHUNK_BYTES + 7]) {
      const data = bytesOf(n);
      const joined = joinChunks(chunkBytes(data));
      expect(equalBytes(joined, data)).toBe(true);
    }
  });
});

describe('TC-02: shouldCompact thresholds', () => {
  it('false at COMPACTION_UPDATE_COUNT - 1, true at exactly COMPACTION_UPDATE_COUNT', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('false at COMPACTION_BYTES - 1, true at exactly COMPACTION_BYTES', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });
});
