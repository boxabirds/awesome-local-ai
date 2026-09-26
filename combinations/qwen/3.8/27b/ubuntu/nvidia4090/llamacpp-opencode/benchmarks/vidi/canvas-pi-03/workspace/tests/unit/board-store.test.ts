import { describe, it, expect } from 'vitest';
import { chunkBytes, joinChunks, shouldCompact } from '@/worker/board-store';
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '@/shared/config';

function bytes(n: number, fill = 1): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (fill + i) & 0xff;
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

describe('persist.board_store (unit)', () => {
  describe('TC-01 chunkBytes / joinChunks', () => {
    it.each([
      ['0 bytes', 0, 0],
      ['1 byte', 1, 1],
      ['exactly SNAPSHOT_CHUNK_BYTES', SNAPSHOT_CHUNK_BYTES, 1],
      ['SNAPSHOT_CHUNK_BYTES + 1', SNAPSHOT_CHUNK_BYTES + 1, 2],
    ])('%s -> %i chunk(s)', (_label, size, wantChunks) => {
      const data = bytes(size);
      const chunks = chunkBytes(data);
      expect(chunks.length).toBe(wantChunks);
      // Every chunk except possibly the last is exactly SNAPSHOT_CHUNK_BYTES.
      for (let i = 0; i < chunks.length; i++) {
        expect(chunks[i].length).toBe(i === chunks.length - 1 ? size - i * SNAPSHOT_CHUNK_BYTES : SNAPSHOT_CHUNK_BYTES);
      }
      // joinChunks round-trips byte-identical.
      expect(joinChunks(chunks)).toEqual(data);
    });

    it('chunk size must be positive', () => {
      expect(() => chunkBytes(bytes(10), 0)).toThrow();
      expect(() => chunkBytes(bytes(10), -5)).toThrow();
    });

    it('joinChunks of an explicit multi-chunk split is byte-identical', () => {
      const data = bytes(SNAPSHOT_CHUNK_BYTES * 3 + 7);
      // Split exactly where chunkBytes would.
      const chunks = chunkBytes(data, SNAPSHOT_CHUNK_BYTES);
      expect(chunks.length).toBe(4);
      expect(concat(...chunks)).toEqual(data);
      expect(joinChunks(chunks)).toEqual(data);
    });

    it('empty chunks -> empty join', () => {
      expect(chunkBytes(bytes(0))).toEqual([]);
      expect(joinChunks([])).toEqual(new Uint8Array(0));
    });
  });

  describe('TC-02 shouldCompact thresholds', () => {
    it('count: below -> false, exactly -> true', () => {
      expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
      expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
    });
    it('bytes: below -> false, exactly -> true', () => {
      expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
      expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
    });
    it('either dimension reaching its threshold compacts', () => {
      expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES - 1)).toBe(true);
      expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES)).toBe(true);
      expect(shouldCompact(0, 0)).toBe(false);
    });
  });
});
