/**
 * TC-01 and TC-02 — the two pure functions of the storage layer: how a snapshot is
 * cut into rows, and when the log is worth folding into one. Both are boundary
 * values, checked at exactly the threshold and one either side of it.
 *
 * Plus `gapFillUpdate`, the third pure function of that layer: what a quarantined
 * log row leaves behind, and how the rest of the board is got back. It is pure
 * Yjs — no Durable Object storage involved — so it is tested here rather than in
 * workerd, which then only has to prove the same thing through real rows.
 */

import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import {
  COMPACTION_BYTES,
  COMPACTION_UPDATE_COUNT,
  SNAPSHOT_CHUNK_BYTES,
} from '../../src/shared/config.js';
import {
  chunkBytes,
  gapFillUpdate,
  joinChunks,
  shouldCompact,
} from '../../src/worker/board-store.js';

/** The bytes 0..n-1, so a round trip can be compared byte for byte. */
const bytes = (n: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => i % 251);

describe('chunkBytes / joinChunks (TC-01)', () => {
  it('is 0, 1, 1, 2 chunks across the boundary, and joins back byte-identical', () => {
    const cases: Array<[name: string, size: number, chunks: number]> = [
      ['empty', 0, 0],
      ['one byte', 1, 1],
      ['exactly one chunk', SNAPSHOT_CHUNK_BYTES, 1],
      ['one byte over', SNAPSHOT_CHUNK_BYTES + 1, 2],
    ];
    for (const [name, size, expected] of cases) {
      const data = bytes(size);
      const pieces = chunkBytes(data);
      expect(pieces, name).toHaveLength(expected);
      expect(joinChunks(pieces), name).toEqual(data);
    }
  });

  it('never makes a row bigger than the chunk size, whatever the input', () => {
    for (const size of [SNAPSHOT_CHUNK_BYTES * 2 + 7, 3 * SNAPSHOT_CHUNK_BYTES]) {
      const pieces = chunkBytes(bytes(size));
      for (const piece of pieces) {
        expect(piece.byteLength).toBeLessThanOrEqual(SNAPSHOT_CHUNK_BYTES);
      }
      expect(joinChunks(pieces)).toEqual(bytes(size));
    }
  });

  it('takes a size of its own', () => {
    expect(chunkBytes(bytes(10), 4)).toHaveLength(3);
    expect(joinChunks(chunkBytes(bytes(10), 4))).toEqual(bytes(10));
  });

  it('refuses a size that would never finish', () => {
    expect(() => chunkBytes(bytes(4), 0)).toThrow(RangeError);
    expect(() => chunkBytes(bytes(4), -1)).toThrow(RangeError);
  });

  it('joins nothing into nothing', () => {
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });
});

describe('shouldCompact (TC-02)', () => {
  it('crosses on the row count, and not before', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true);
  });

  it('crosses on the byte total, and not before', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true);
  });

  it('is false below both thresholds and true above either', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES - 1)).toBe(false);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, COMPACTION_BYTES)).toBe(true);
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES - 1)).toBe(true);
    expect(shouldCompact(0, 0)).toBe(false);
  });
});

describe('gapFillUpdate', () => {
  /** The bytes Yjs is holding back because something earlier is missing. */
  const pendingOf = (doc: Y.Doc) =>
    (
      doc.store as unknown as {
        pendingStructs?: { missing: Map<number, number>; update: Uint8Array } | null;
      }
    ).pendingStructs ?? null;

  /** Close every hole `doc` is holding bytes back for. How many were closed. */
  const closeEveryHole = (doc: Y.Doc, limit = 10): number => {
    let closed = 0;
    for (;;) {
      const pending = pendingOf(doc);
      if (pending === null) return closed;
      const fill = gapFillUpdate(Y.encodeStateVector(doc), pending.missing);
      if (fill === null) return closed;
      Y.applyUpdate(doc, fill);
      closed += 1;
      expect(closed, 'closing holes must not loop forever').toBeLessThanOrEqual(limit);
    }
  };

  /**
   * A board of `notes` sticky notes, one stored row per change — the shape the log
   * has, so "damage in the middle of the log" is the same shape here.
   */
  const logOf = (notes: number): Uint8Array[] => {
    const doc = new Y.Doc();
    const rows: Uint8Array[] = [];
    doc.on('update', (update) => rows.push(update.slice()));
    doc.getMap('meta').set('schemaVersion', 1);
    const objects = doc.getMap('objects');
    for (let index = 0; index < notes; index += 1) {
      const note = new Y.Map();
      note.set('type', 'sticky');
      note.set('x', index * 100);
      note.set('text', new Y.Text());
      objects.set(`note-${index}`, note);
      (note.get('text') as Y.Text).insert(0, `note ${index}`);
    }
    return rows;
  };

  /** The rows applied into a fresh doc in order, with `damaged` cut short. */
  const loadWithDamage = (rows: readonly Uint8Array[], damaged: number) => {
    const doc = new Y.Doc();
    const quarantined: number[] = [];
    rows.forEach((row, index) => {
      const data = index === damaged ? row.slice(0, Math.max(1, row.byteLength - 10)) : row;
      try {
        Y.applyUpdate(doc, data);
      } catch {
        quarantined.push(index);
      }
    });
    return { doc, quarantined };
  };

  /** The text of every note the board has, empty for a note without one. */
  const textsOf = (doc: Y.Doc): string[] => {
    const texts: string[] = [];
    doc.getMap('objects').forEach((value) => {
      const text = (value as Y.Map<unknown>).get('text') as Y.Text | undefined;
      texts.push(text === undefined ? '' : text.toString());
    });
    return texts.sort();
  };

  it('says nothing when there is no gap to close', () => {
    expect(gapFillUpdate(Y.encodeStateVector(new Y.Doc()), new Map())).toBeNull();
  });

  it('without the fill, a damaged row loses everything behind it', () => {
    const rows = logOf(4);
    const damaged = 3;
    const { doc, quarantined } = loadWithDamage(rows, damaged);
    expect(quarantined).toEqual([damaged]);
    // The problem the fill solves: every row after the damaged one is intact, and
    // the board still comes back with almost nothing on it.
    expect(textsOf(doc).length).toBe(1);
    expect(pendingOf(doc)).not.toBeNull();
  });

  it('closes the hole so only the damaged change is missing', () => {
    const notes = 4;
    const rows = logOf(notes);
    for (const damaged of [1, 2, 3, rows.length - 1]) {
      const { doc, quarantined } = loadWithDamage(rows, damaged);
      expect(quarantined).toEqual([damaged]);
      const closed = closeEveryHole(doc);
      const texts = textsOf(doc);

      // The damage stops at the damaged row: the change that came before it is
      // untouched, which it would not be if the fill covered more than the gap.
      expect(doc.getMap('meta').get('schemaVersion')).toBe(1);

      // Whichever row it was, exactly one change is missing: the note it made, or
      // the text it wrote. Everything else is there.
      expect(texts.length, `note ${damaged} damaged`).toBeGreaterThanOrEqual(notes - 1);
      expect(texts.filter((text) => text !== '').length, `note ${damaged} damaged`).toBe(notes - 1);
      // Nothing is held back any more: the rows that survived are all integrated.
      expect(pendingOf(doc), `note ${damaged} damaged`).toBeNull();
      // Only a row with rows behind it leaves a hole to close.
      expect(closed, `note ${damaged} damaged`).toBe(damaged === rows.length - 1 ? 0 : 1);
    }
  });

  it('leaves the board able to take the rows it missed later', () => {
    const rows = logOf(4);
    const damaged = 2; // the change that wrote note 0's text
    const { doc } = loadWithDamage(rows, damaged);
    closeEveryHole(doc);

    // The board a client would sync against: the full log, undamaged. Merging it
    // in must be safe — no throw, no duplicates — and the one change that was
    // declared gone stays gone: that is the trade the design makes rather than
    // lose the board behind it.
    const full = new Y.Doc();
    for (const row of rows) Y.applyUpdate(full, row);
    expect(() => Y.applyUpdate(doc, Y.encodeStateAsUpdate(full))).not.toThrow();

    const positionsOf = (d: Y.Doc): unknown[] => {
      const positions: unknown[] = [];
      d.getMap('objects').forEach((value) => {
        const note = value as Y.Map<unknown>;
        positions.push([note.get('type'), note.get('x')]);
      });
      return positions.sort();
    };
    expect(positionsOf(doc)).toEqual(positionsOf(full));
    // The clocks all add up: the fill covered the gap and nothing else, so the two
    // boards have the same state vector even though one change did not come back.
    expect(Array.from(Y.decodeStateVector(Y.encodeStateVector(doc)))).toEqual(
      Array.from(Y.decodeStateVector(Y.encodeStateVector(full))),
    );
    const recovered = textsOf(doc);
    expect(recovered.filter((text) => text !== '').length).toBe(
      textsOf(full).filter((text) => text !== '').length - 1,
    );

    // And the recovered board syncs onwards normally: a third doc that starts
    // from it sees the same board.
    const third = new Y.Doc();
    Y.applyUpdate(third, Y.encodeStateAsUpdate(doc));
    expect(textsOf(third)).toEqual(recovered);
  });
});
