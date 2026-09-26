// Story 4, task 1: chunking unit tests (TC-01, TC-02).
//
// The snapshot is a single Yjs update split at fixed byte offsets; Yjs
// updates are self-delimiting, so the join of the chunks is byte-identical
// to the original update and applies to a fresh doc.

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_CHUNK_BYTES,
  PERSIST_TESTED_NOTES,
} from '../../src/shared/config';
import { chunkUpdate, joinChunks, shouldCompact } from '../../src/worker/board-store';
import { COMPACTION_UPDATE_COUNT, COMPACTION_BYTES } from '../../src/shared/config';
import { generateLargeBoard, generateRetroBoard } from '../fixtures/boards';

describe('chunkUpdate / joinChunks (task 1)', () => {
  it('TC-01: a ~1MB board snapshot splits into chunks and rejoins byte-identical', () => {
    // A few hundred KB would do; use the named 2000-note fixture so the
    // chunking path is exercised on the same shape the persistence e2e uses.
    const { doc } = generateLargeBoard(1500);
    const update = Y.encodeStateAsUpdate(doc);
    expect(update.byteLength).toBeGreaterThan(SNAPSHOT_CHUNK_BYTES);

    const chunks = chunkUpdate(update, SNAPSHOT_CHUNK_BYTES);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
    }
    expect(joinChunks(chunks).byteLength).toBe(update.byteLength);
    // Byte-identical rejoin.
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(update));
  });

  it('TC-01: the rejoined multi-chunk snapshot applies to a fresh doc and matches the original', () => {
    const { doc } = generateLargeBoard(300);
    const update = Y.encodeStateAsUpdate(doc);
    const rejoined = joinChunks(chunkUpdate(update, SNAPSHOT_CHUNK_BYTES));

    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, rejoined, 'test');
    expect(Array.from(Y.encodeStateAsUpdate(fresh))).toEqual(Array.from(update));
  });

  it('TC-02: a 25-note board snapshot fits one chunk', () => {
    const { doc } = generateRetroBoard();
    const update = Y.encodeStateAsUpdate(doc);
    expect(update.byteLength).toBeLessThan(SNAPSHOT_CHUNK_BYTES);
    const chunks = chunkUpdate(update, SNAPSHOT_CHUNK_BYTES);
    expect(chunks.length).toBe(1);
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(update));
  });

  it('edge cases: empty update -> no chunks; exact multiple; single-byte size', () => {
    expect(chunkUpdate(new Uint8Array(0), 16)).toEqual([]);
    expect(joinChunks([]).byteLength).toBe(0);

    const exact = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const exactChunks = chunkUpdate(exact, 2);
    expect(exactChunks.map((c) => c.byteLength)).toEqual([2, 2, 2]);
    expect(Array.from(joinChunks(exactChunks))).toEqual([1, 2, 3, 4, 5, 6]);

    const one = new Uint8Array([9, 8, 7]);
    expect(chunkUpdate(one, 1).map((c) => c.byteLength)).toEqual([1, 1, 1]);
    expect(Array.from(joinChunks(chunkUpdate(one, 1)))).toEqual([9, 8, 7]);
  });

  it('shouldCompact fires exactly at both thresholds (TC-17 boundary)', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true);
  });

  it('the 2000-note fixture snapshot is multi-chunk (TC-08 shape)', () => {
    const { doc, noteCount } = generateLargeBoard(PERSIST_TESTED_NOTES);
    expect(noteCount).toBe(PERSIST_TESTED_NOTES);
    const update = Y.encodeStateAsUpdate(doc);
    expect(chunkUpdate(update, SNAPSHOT_CHUNK_BYTES).length).toBeGreaterThan(1);
  });
});
