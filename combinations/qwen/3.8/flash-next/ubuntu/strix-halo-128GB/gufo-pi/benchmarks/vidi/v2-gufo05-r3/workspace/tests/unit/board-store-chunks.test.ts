/**
 * The pure maths behind board storage (task 1): TC-01 (chunking) and TC-02
 * (the compaction threshold). Both are tested at their boundary values, because
 * a chunk that is one byte too big is a rejected write and a threshold that is
 * one row too eager is a compaction on every keystroke.
 */
import { describe, expect, it } from 'vitest';

import * as Y from 'yjs';

import {
  chunkBytes,
  joinChunks,
  shouldCompact,
  updateRanges,
} from '../../src/worker/board-store';
import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config';

/** Bytes 0..255 repeating, so a round trip can be compared byte by byte. */
function pattern(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 251;
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('chunkBytes / joinChunks (TC-01)', () => {
  const sizes = [0, 1, SNAPSHOT_CHUNK_BYTES, SNAPSHOT_CHUNK_BYTES + 1];
  const expectedChunks = [0, 1, 1, 2];

  for (const [index, size] of sizes.entries()) {
    it(`splits ${size} bytes into ${expectedChunks[index]} chunk(s) and back`, () => {
      const data = pattern(size);
      const chunks = chunkBytes(data);
      expect(chunks).toHaveLength(expectedChunks[index]);
      for (const chunk of chunks) {
        expect(chunk.byteLength).toBeGreaterThan(0);
        expect(chunk.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }
      expect(joinChunks(chunks).byteLength, 'joined length').toBe(size);
      expect(sameBytes(joinChunks(chunks), data), 'round trip').toBe(true);
    });
  }

  it('never loses a byte across an awkward size and chunk size', () => {
    for (const size of [7, 63, 64, 65]) {
      for (const chunk of [1, 8, 64]) {
        const data = pattern(size);
        const chunks = chunkBytes(data, chunk);
        expect(chunks).toHaveLength(Math.ceil(size / chunk));
        expect(sameBytes(joinChunks(chunks), data), `${size}/${chunk}`).toBe(true);
      }
    }
  });
});

describe('shouldCompact (TC-02)', () => {
  it('fires on exactly COMPACTION_UPDATE_COUNT rows, not one before', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('fires on exactly COMPACTION_BYTES, not one byte before', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('stays quiet below both thresholds and fires when either is reached', () => {
    expect(shouldCompact(0, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true);
  });
});

/**
 * The update header is what tells a load that the log has a hole: each update
 * states the clock range it writes, and a document that stopped short of a range
 * it was handed is missing everything after the gap.
 */
describe('updateRanges (TC-09 support)', () => {
  it('reads the range of one transaction from a fresh document', () => {
    const doc = new Y.Doc();
    const update = capture(doc, () => doc.getMap('m').set('k', 1));
    expect(updateRanges(update)).toEqual([{ client: doc.clientID, from: 0, to: 1 }]);
  });

  it('names the clock each row of a log continues from, text included', () => {
    const doc = new Y.Doc();
    const updates: Uint8Array[] = [];
    doc.on('update', (update) => updates.push(update.slice()));
    const objects = doc.getMap('objects');
    for (let i = 0; i < 8; i++) {
      const note = new Y.Map<unknown>([]);
      objects.set(`n${i}`, note);
      // A text insert spans one clock position per character, which is why the end
      // of a row cannot be counted in structs.
      note.set('text', new Y.Text(`note number ${i}`));
      note.set('x', String(i * 10));
    }
    expect(updates.length).toBeGreaterThan(10);

    const replay = new Y.Doc();
    for (const [index, update] of updates.entries()) {
      const before = clock(replay, doc.clientID);
      const ranges = updateRanges(update);
      expect(ranges, `row ${index} is one client's work`).toEqual([
        { client: doc.clientID, from: before, to: expect.any(Number) },
      ]);
      Y.applyUpdate(replay, update);
      expect(
        clock(replay, doc.clientID),
        `row ${index}: a counted number of structs is a floor for the clock`,
      ).toBeGreaterThanOrEqual(ranges[0]!.to);
    }
    expect(clock(replay, doc.clientID), 'the whole log replays to one clock').toBe(
      clock(doc, doc.clientID),
    );
  });

  it('describes a full-state update by the range it covers', () => {
    const source = new Y.Doc();
    const objects = source.getMap('objects');
    for (let i = 0; i < 30; i++) objects.set(`n${i}`, new Y.Map([[`v${i}`, i]]));
    const encoded = Y.encodeStateAsUpdate(source);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, encoded);
    const reached = Y.decodeStateVector(Y.encodeStateVector(copy)).get(source.clientID) ?? 0;
    expect(updateRanges(encoded), 'a full-state update starts at clock 0 and covers everything').toEqual([
      { client: source.clientID, from: 0, to: reached },
    ]);
  });

  it('says nothing rather than wrong about bytes that are not an update header', () => {
    const doc = new Y.Doc();
    const update = capture(doc, () => doc.getMap('m').set('k', 1));
    // A cut update, and a run of bytes whose first number claims a huge client count.
    expect(() => updateRanges(update.slice(0, 1))).toThrow();
    expect(() => updateRanges(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]))).toThrow();
  });
});

/** The clock a document has reached for one client. */
function clock(doc: Y.Doc, client: number): number {
  return Y.decodeStateVector(Y.encodeStateVector(doc)).get(client) ?? 0;
}

/** The update one body of work produces, or throws if it produces none. */
function capture(doc: Y.Doc, body: () => void): Uint8Array {
  const updates: Uint8Array[] = [];
  const listener = (update: Uint8Array) => updates.push(update.slice());
  doc.on('update', listener);
  try {
    body();
  } finally {
    doc.off('update', listener);
  }
  expect(updates).toHaveLength(1);
  return updates[0]!;
}
