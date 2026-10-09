import { describe, expect, it } from 'vitest';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config';
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store';

function bytesOfLength(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) bytes[i] = (i * 31 + 7) & 0xff;
  return bytes;
}

describe('TC-01 chunkBytes / joinChunks boundaries', () => {
  it('produces the expected chunk counts at the exact boundaries', () => {
    expect(chunkBytes(new Uint8Array(0))).toHaveLength(0);
    expect(chunkBytes(bytesOfLength(1))).toHaveLength(1);
    expect(chunkBytes(bytesOfLength(SNAPSHOT_CHUNK_BYTES))).toHaveLength(1);
    expect(chunkBytes(bytesOfLength(SNAPSHOT_CHUNK_BYTES + 1))).toHaveLength(2);
  });

  it('keeps every chunk within the configured size', () => {
    for (const chunks of [chunkBytes(bytesOfLength(SNAPSHOT_CHUNK_BYTES * 2 + 5)), chunkBytes(bytesOfLength(0))]) {
      for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    }
  });

  it('round-trips byte-identically across chunk boundaries', () => {
    for (const length of [0, 1, SNAPSHOT_CHUNK_BYTES - 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1]) {
      const original = bytesOfLength(length);
      const joined = joinChunks(chunkBytes(original));
      expect(joined).toEqual(original);
    }
  });

  it('joinChunks of no chunks is empty', () => {
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });
});

describe('TC-02 shouldCompact thresholds', () => {
  it('triggers on update count exactly at the threshold, not below', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('triggers on byte total exactly at the threshold, not below', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('below both thresholds stays false', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
  });
});
