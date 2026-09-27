/**
 * tests/unit/yjs-damage-semantics.test.ts
 *
 * The properties of Yjs that `BoardStore.load` is built on, measured here rather
 * than assumed. Each one is a sentence in the comment above `load`, and each one
 * is the opposite of what "just skip the bad row" sounds like it should do.
 *
 * Nothing of the product is involved except the update bytes a real board
 * produces, so what fails here is the model the storage layer reasons with.
 */
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { snapshot } from '../../src/shared/board-model';
import { retroBoard, truncatedUpdate, unreadableBytes } from '../fixtures/boards';

/** The updates one board produces, in the order the document emitted them. */
function boardUpdates(noteCount: number): Uint8Array[] {
  const doc = new Y.Doc();
  const updates: Uint8Array[] = [];
  doc.on('update', (update: Uint8Array) => updates.push(update));
  retroBoard(doc, noteCount);
  return updates;
}

/** Apply every update, letting none of them throw. */
function applyAll(doc: Y.Doc, updates: Uint8Array[]): void {
  for (const update of updates) {
    try {
      Y.applyUpdate(doc, update);
    } catch {
      // Refused. What a refusal leaves behind is what this file measures.
    }
  }
}

const stateVector = (doc: Y.Doc): string => Y.encodeStateVector(doc).join(',');

/** Everything a viewer would show: position, stacking, colour and text. */
const visible = (doc: Y.Doc): string =>
  snapshot(doc)
    .map((note) => `${note.id}:${note.x}:${note.y}:${note.z}:${note.color}:${note.text}`)
    .join('|');

describe('a damaged update, measured', () => {
  it('is refused by decoding, and decoding leaves the document alone', () => {
    const updates = boardUpdates(8);
    const damaged = truncatedUpdate(updates[3] as Uint8Array);
    const doc = new Y.Doc();

    expect(() => Y.decodeUpdate(damaged)).toThrow();
    // Nothing was applied by the attempt, and the document still works.
    expect(snapshot(doc).length).toBe(0);
    Y.applyUpdate(doc, updates[0] as Uint8Array);
    expect(() => Y.applyUpdate(doc, updates[1] as Uint8Array)).not.toThrow();
  });

  it('costs every later row: an update whose dependencies were skipped never integrates', () => {
    const updates = boardUpdates(8);
    const gap = 3;

    const prefix = new Y.Doc();
    applyAll(prefix, updates.slice(0, gap));
    const vectorBefore = stateVector(prefix);

    const skipped = new Y.Doc();
    applyAll(skipped, updates.slice(0, gap));
    applyAll(skipped, updates.slice(gap + 1));

    // The rows after the gap are taken and queued: the state vector, which is
    // how much of the log a document holds, does not move.
    expect(stateVector(skipped)).toBe(vectorBefore);
    expect(snapshot(skipped).length).toBe(snapshot(prefix).length);
  });

  it('silently changes what the board shows if the rows after it are applied anyway', () => {
    // The reason a load stops at the first row it cannot place instead of
    // carrying on: applying the rest does not merely skip a change, it alters
    // content that the readable rows already established.
    for (const [noteCount, gap] of [
      [8, 12],
      [8, 19],
      [25, 38],
    ] as const) {
      const updates = boardUpdates(noteCount);

      const prefix = new Y.Doc();
      applyAll(prefix, updates.slice(0, gap));

      const continued = new Y.Doc();
      applyAll(continued, updates.slice(0, gap));
      applyAll(continued, updates.slice(gap + 1));

      expect(snapshot(continued).length).toBe(snapshot(prefix).length);
      expect(visible(continued)).not.toBe(visible(prefix));
    }
  });

  it('marks the document with a row it refused, without taking it', () => {
    // The reason `BoardStore.load` replays the rows it accepted rather than
    // carrying on with the document that met the damage: one refused row moves
    // what the board shows while the state vector — the only thing that reports
    // how much of the log a document holds — says nothing happened.
    const updates = boardUpdates(25);
    const gap = 38;

    const prefix = new Y.Doc();
    applyAll(prefix, updates.slice(0, gap));

    const attempted = new Y.Doc();
    applyAll(attempted, updates.slice(0, gap));
    applyAll(attempted, updates.slice(gap + 1, gap + 2));

    expect(stateVector(attempted)).toBe(stateVector(prefix));
    expect(visible(attempted)).not.toBe(visible(prefix));
  });

  it('leaves a board identical to a shorter log when the replay stops at it', () => {
    // The rule `BoardStore.load` follows: stop at the first update that does not
    // become part of the document. Both ways of meeting a damaged row — it does
    // not decode, or it decodes and is refused — have to end at the same board
    // the log would have made had its tail never been written.
    const updates = boardUpdates(25);
    const gap = 38;

    const shorter = new Y.Doc();
    applyAll(shorter, updates.slice(0, gap));

    // `BoardStore.load`, in a dozen lines: stop at the first row that does not
    // become part of the document, then build what is served from the rows that
    // did — the document that met the damage is thrown away.
    const stopAt = (rows: Uint8Array[]): Y.Doc => {
      const doc = new Y.Doc();
      const accepted: Uint8Array[] = [];
      for (const update of rows) {
        let refused = false;
        try {
          Y.decodeUpdate(update);
          const before = stateVector(doc);
          Y.applyUpdate(doc, update);
          refused = stateVector(doc) === before;
        } catch {
          refused = true;
        }
        if (refused) break;
        accepted.push(update);
      }
      const served = new Y.Doc();
      applyAll(served, accepted);
      return served;
    };

    const undecodable = [
      ...updates.slice(0, gap),
      unreadableBytes((updates[gap] as Uint8Array).byteLength),
      ...updates.slice(gap + 1),
    ];
    expect(visible(stopAt(undecodable))).toBe(visible(shorter));

    // The same board when the damaged row has gone altogether, which is what a
    // row that decodes and cannot be placed amounts to.
    const missing = [...updates.slice(0, gap), ...updates.slice(gap + 1)];
    expect(visible(stopAt(missing))).toBe(visible(shorter));
  });

  it('is what 0xFF bytes are at every length, which is why the fixtures damage rows that way', () => {
    // Random bytes are unusable as a fixture: some lengths of them parse as a
    // legal empty update, so the test would depend on the seed. Every length of
    // this is refused — the varuint header runs off the end or leaves an integer
    // out of range.
    for (let length = 1; length <= 64; length++) {
      expect(() => Y.decodeUpdate(unreadableBytes(length))).toThrow();
    }
  });
});
