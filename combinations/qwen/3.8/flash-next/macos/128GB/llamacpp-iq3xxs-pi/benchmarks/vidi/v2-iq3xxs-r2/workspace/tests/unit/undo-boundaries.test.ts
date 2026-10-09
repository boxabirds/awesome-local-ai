// The clock the capture window reads has to be patched before `yjs` is imported; see
// ./fake-clock.ts.
import './fake-clock';
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { fakeClock } from './fake-clock';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import {
  LOCAL_ORIGIN,
  createSticky,
  getStickyText,
  initDoc,
  moveObjects,
} from '../../src/shared/board-model';
import { createUndo, type UndoController } from '../../src/client/board/undo';

/**
 * `undo.boundaries` at the level of the capture window (TC-12, TC-13): transactions are
 * written through the real document with `LOCAL_ORIGIN` — the way every mutation in
 * `src/shared/board-model.ts` writes them — and the clock `yjs` compares against
 * `UNDO_CAPTURE_TIMEOUT_MS` is moved by the test, so the boundary values are hit exactly
 * instead of roughly.
 */

let controller: UndoController | null = null;

afterEach(() => {
  controller?.destroy();
  controller = null;
  fakeClock.reset();
});

function board(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function sticky(doc: Y.Doc, at: { x: number; y: number }): string {
  const created = createSticky(doc, at);
  if (created === false) throw new Error('sticky note rejected by the model');
  return created;
}

/** A note made before the controller exists, so its creation is nobody's step. */
function noteText(doc: Y.Doc): Y.Text {
  const ytext = getStickyText(doc, sticky(doc, { x: 0, y: 0 }));
  if (!ytext) throw new Error('sticky has no text');
  return ytext;
}

/** One keystroke, written the way this client writes it. */
function keystroke(doc: Y.Doc, ytext: Y.Text, char: string): void {
  doc.transact(() => ytext.insert(ytext.length, char), LOCAL_ORIGIN);
}

/** Move the clock on by `ms` and type the next character. */
function pauseAndType(doc: Y.Doc, ytext: Y.Text, char: string, ms: number): void {
  fakeClock.advance(ms);
  keystroke(doc, ytext, char);
}

function positionOf(doc: Y.Doc, id: string): { x: number; y: number } {
  const item = doc.getMap<Y.Map<unknown>>('objects').get(id);
  if (!item) throw new Error(`object ${id} is gone`);
  return { x: Number(item.get('x')), y: Number(item.get('y')) };
}

describe('typing bursts (TC-12, TC-13)', () => {
  it('TC-12: keystrokes 100 ms apart are one undo step', () => {
    const doc = board();
    const ytext = noteText(doc);
    controller = createUndo(doc);

    controller.boundary(); // the edit starts
    keystroke(doc, ytext, 'h');
    for (const char of 'ello') pauseAndType(doc, ytext, char, 100);
    controller.boundary(); // the edit ends

    expect(ytext.toString()).toBe('hello');
    expect(controller.canUndo()).toBe(true);

    expect(controller.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(controller.canUndo()).toBe(false);
  });

  it('TC-13: a pause of exactly UNDO_CAPTURE_TIMEOUT_MS is two steps, one millisecond less is one', () => {
    const doc = board();
    const ytext = noteText(doc);
    controller = createUndo(doc);

    controller.boundary();
    keystroke(doc, ytext, 'a');
    pauseAndType(doc, ytext, 'b', UNDO_CAPTURE_TIMEOUT_MS);
    controller.boundary();

    expect(controller.undo()).toBe(true);
    expect(ytext.toString()).toBe('a');
    expect(controller.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
    expect(controller.undo()).toBe(false);

    // One millisecond below the boundary: still one burst.
    const second = board();
    const secondText = noteText(second);
    const secondUndo = createUndo(second);
    controller = secondUndo;
    secondUndo.boundary();
    keystroke(second, secondText, 'a');
    pauseAndType(second, secondText, 'b', UNDO_CAPTURE_TIMEOUT_MS - 1);
    secondUndo.boundary();

    expect(secondUndo.undo()).toBe(true);
    expect(secondText.toString()).toBe('');
    expect(secondUndo.canUndo()).toBe(false);
  });

  it('a boundary with nothing behind it is a no-op (error path)', () => {
    const doc = board();
    controller = createUndo(doc);

    expect(controller.canUndo()).toBe(false);
    expect(() => controller?.boundary()).not.toThrow();
    expect(controller.canUndo()).toBe(false);
    expect(controller.undo()).toBe(false);

    // …and the window opens again for the next change, which is still one whole step.
    const ytext = noteText(doc);
    keystroke(doc, ytext, 'x');
    expect(controller.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
  });

  it('a step that is not typing is not merged with the typing before it', () => {
    const doc = board();
    const ytext = noteText(doc);
    const moved = sticky(doc, { x: 400, y: 0 });
    controller = createUndo(doc);

    controller.boundary();
    keystroke(doc, ytext, 't');
    pauseAndType(doc, ytext, 'x', 100);
    controller.boundary();
    // A move 200 ms later — inside the capture window, but after a boundary.
    fakeClock.advance(200);
    moveObjects(doc, new Map([[moved, { x: 900, y: 900 }]]));
    controller.boundary();

    expect(controller.undo()).toBe(true);
    expect(positionOf(doc, moved)).toEqual({ x: 300, y: -100 });
    expect(ytext.toString()).toBe('tx');

    expect(controller.undo()).toBe(true);
    expect(ytext.toString()).toBe('');
  });
});
