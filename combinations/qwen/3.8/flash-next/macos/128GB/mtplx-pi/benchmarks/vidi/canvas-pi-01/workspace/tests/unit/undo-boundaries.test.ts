/**
 * Story 8 · task 7 — typing-burst boundary unit tests (TC-12, TC-13).
 *
 * The point is that a burst of typing inside one note is ONE undo step, and a
 * fresh step only opens after a pause of `captureTimeout` or more. `Y.UndoManager`
 * cannot be driven by test fake timers because it captures `Date.now` at import,
 * so the controller reads its own injectable clock instead (see `createUndo`'s
 * `clock` option); each test advances that clock between keystrokes so the
 * assertion is fully deterministic.
 *
 * Model of "typing": before every character the editor calls `undo.typingEdit()`
 * and then writes one character to the note's `Y.Text` under `LOCAL_ORIGIN`. The
 * controller merges a run of characters into one step while gaps stay under the
 * capture timeout.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { createSticky, initDoc, LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import type { UndoController } from '../../src/client/board/undo';

function note() {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createSticky(doc, { x: 100, y: 100 });
  const text = doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('text') as Y.Text;
  return { doc, id, text };
}

/**
 * Type one character per entry, advancing the injected clock by each entry's gap
 * before calling `typingEdit()` and writing the character.
 */
function type(
  doc: Y.Doc,
  text: Y.Text,
  chars: string[],
  gaps: number[],
  clock: { t: number },
  ctl: UndoController,
): void {
  chars.forEach((ch, i) => {
    clock.t += gaps[i] ?? 0;
    ctl.typingEdit();
    doc.transact(() => text.insert(text.length, ch), LOCAL_ORIGIN);
  });
}

describe('typing bursts merge into one step', () => {
  it('TC-12: a burst typed 100 ms per key is a single undo step, undone in one go', () => {
    const { doc, text } = note();
    const clock = { t: 0 };
    const ctl = createUndo(doc, { clock: () => clock.t });

    // An open editing session: a boundary at the start, then continuous typing.
    ctl.boundary();
    type(doc, text, ['a', 'b', 'c', 'd', 'e'], [0, 100, 100, 100, 100], clock, ctl);
    expect(text.toString()).toBe('abcde');

    expect(ctl.undoDepth()).toBe(1);
    ctl.undo();
    expect(text.toString()).toBe('');
  });

  it('TC-13: a pause of exactly the capture timeout opens a second step; one ms less stays merged', () => {
    const exact = note();
    const clockA = { t: 0 };
    const ctlA = createUndo(exact.doc, { clock: () => clockA.t });
    ctlA.boundary();
    type(exact.doc, exact.text, ['x', 'y'], [0, UNDO_CAPTURE_TIMEOUT_MS], clockA, ctlA);
    expect(exact.text.toString()).toBe('xy');
    expect(ctlA.undoDepth()).toBe(2);
    // The two steps undo independently.
    ctlA.undo();
    expect(exact.text.toString()).toBe('x');

    const short = note();
    const clockB = { t: 0 };
    const ctlB = createUndo(short.doc, { clock: () => clockB.t });
    ctlB.boundary();
    type(short.doc, short.text, ['x', 'y'], [0, UNDO_CAPTURE_TIMEOUT_MS - 1], clockB, ctlB);
    expect(short.text.toString()).toBe('xy');
    expect(ctlB.undoDepth()).toBe(1);
    ctlB.undo();
    expect(short.text.toString()).toBe('');
  });

  it('a gesture boundary followed by typing keeps the two changes in separate steps', () => {
    const { doc, id, text } = note();
    const clock = { t: 0 };
    const ctl = createUndo(doc, { clock: () => clock.t });
    // Drag the note (its own step), release at a boundary, then type in it.
    ctl.boundary();
    doc.transact(() => {
      doc.getMap<Y.Map<unknown>>('objects').get(id)!.set('x', 50);
    }, LOCAL_ORIGIN);
    ctl.boundary();
    type(doc, text, ['h'], [0], clock, ctl);
    expect(ctl.undoDepth()).toBe(2);
    // Undo the typing first (the move is untouched), then the move itself.
    ctl.undo();
    expect(text.toString()).toBe('');
    expect(doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('x')).toBe(50);
    ctl.undo();
    // The move is reversed independently of the typing.
    expect(doc.getMap<Y.Map<unknown>>('objects').get(id)!.get('x')).not.toBe(50);
  });
});