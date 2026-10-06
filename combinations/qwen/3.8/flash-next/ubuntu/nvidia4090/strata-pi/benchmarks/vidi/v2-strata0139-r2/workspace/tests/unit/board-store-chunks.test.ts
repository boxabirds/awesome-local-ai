/**
 * Unit tests for the pure storage logic of `persist.board_store` (TC-01, TC-02).
 *
 * Chunking and the compaction threshold are arithmetic with a platform limit
 * behind them, so they are tested at their exact boundaries here; everything
 * that needs real SQLite is in `tests/integration/board-store.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from "../../src/shared/config";
import { chunkBytes, joinChunks, shouldCompact } from "../../src/worker/board-store";

function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i += 1) out[i] = (i * 7 + 3) % 256;
  return out;
}

describe("chunkBytes / joinChunks (TC-01)", () => {
  const cases: { name: string; length: number; expectedChunks: number }[] = [
    { name: "0 bytes", length: 0, expectedChunks: 0 },
    { name: "1 byte", length: 1, expectedChunks: 1 },
    { name: "exactly SNAPSHOT_CHUNK_BYTES", length: SNAPSHOT_CHUNK_BYTES, expectedChunks: 1 },
    { name: "SNAPSHOT_CHUNK_BYTES + 1", length: SNAPSHOT_CHUNK_BYTES + 1, expectedChunks: 2 },
  ];

  for (const testCase of cases) {
    it(`${testCase.name} → ${testCase.expectedChunks} chunk(s), joined back byte-identical`, () => {
      const data = bytes(testCase.length);
      const chunks = chunkBytes(data);

      expect(chunks.length).toBe(testCase.expectedChunks);
      for (const chunk of chunks) {
        expect(chunk.byteLength).toBeGreaterThan(0);
        expect(chunk.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }
      expect(chunks.reduce((total, chunk) => total + chunk.byteLength, 0)).toBe(testCase.length);
      expect(Array.from(joinChunks(chunks))).toEqual(Array.from(data));
    });
  }

  it("an explicit size chunks the same way (the room always passes the setting)", () => {
    const data = bytes(10);
    const chunks = chunkBytes(data, 4);
    expect(chunks.map((chunk) => chunk.byteLength)).toEqual([4, 4, 2]);
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(data));
  });

  it("chunks never alias the input, so a chunked snapshot cannot be mutated by the document", () => {
    const data = bytes(8);
    const chunks = chunkBytes(data, 4);
    chunks[0]![0] = 0;
    expect(data[0]).not.toBe(0);
  });

  it("joinChunks of no chunks is an empty array", () => {
    expect(joinChunks([]).byteLength).toBe(0);
  });
});

describe("shouldCompact (TC-02)", () => {
  it("one row below COMPACTION_UPDATE_COUNT does not compact", () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
  });

  it("exactly COMPACTION_UPDATE_COUNT rows compacts", () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it("one byte below COMPACTION_BYTES does not compact", () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
  });

  it("exactly COMPACTION_BYTES compacts", () => {
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it("either threshold alone is enough, and zero of both is not", () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(1, COMPACTION_BYTES + 1)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, 1)).toBe(true);
  });
});
