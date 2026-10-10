import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import { createSticky, getStickyText, initDoc } from '../../src/shared/board-model';
import { LOCAL_ORIGIN } from '../../src/shared/board-model';
import { UNDO_CAPTURE_TIMEOUT_MS } from '../../src/shared/config';
import { createUndo } from '../../src/client/board/undo';
import type { FakeClock } from './setup-clock';

// The UndoManager reads its clock through lib0/time, which captures Date.now
// by value at module load, so vi.useFakeTimers() cannot reach it. tests/unit/
// setup-clock.ts installs a wrapper consulted while a test activates the fake
// clock, which makes the capture-window boundaries exact instead of racy.
const clock: FakeClock = globalThis.__vidi6UndoClock ?? { active: false, now: 0 };

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

// One keystroke commit, exactly as the text editor writes it.
function typeInto(doc: Y.Doc, id: string, chars: string): void {
  doc.transact(() => {
    const text = getStickyText(doc, id);
    if (text !== undefined) text.insert(text.length, chars);
  }, LOCAL_ORIGIN);
}

describe('undo.boundaries capture window', () => {
  beforeEach(() => {
    clock.active = true;
    clock.now = 1_000_000;
  });

  afterEach(() => {
    clock.active = false;
  });

  test('TC-12: keystrokes 100 ms apart inside one edit burst are a single step', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary(); // edit start

    typeInto(doc, id, 'a');
    clock.now += 100;
    typeInto(doc, id, 'b');
    clock.now += 100;
    typeInto(doc, id, 'c');
    undo.boundary(); // edit end

    expect(getStickyText(doc, id)!.toString()).toBe('abc');
    expect(undo.undo()).toBe(true); // the whole burst goes in one step
    expect(getStickyText(doc, id)!.toString()).toBe('');
    // Only the creation step is left.
    expect(undo.undo()).toBe(true);
    expect(doc.getMap('objects').size).toBe(0);
    expect(undo.undo()).toBe(false);
    undo.destroy();
  });

  test('TC-13: a pause of exactly UNDO_CAPTURE_TIMEOUT_MS starts a new step', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();

    typeInto(doc, id, 'a');
    clock.now += UNDO_CAPTURE_TIMEOUT_MS;
    typeInto(doc, id, 'b');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(getStickyText(doc, id)!.toString()).toBe('a'); // two separate steps
    expect(undo.undo()).toBe(true);
    expect(getStickyText(doc, id)!.toString()).toBe('');
    undo.destroy();
  });

  test('TC-13: a pause of UNDO_CAPTURE_TIMEOUT_MS minus 1 ms stays one step', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    const id = createSticky(doc, { x: 0, y: 0 });
    undo.boundary();

    typeInto(doc, id, 'a');
    clock.now += UNDO_CAPTURE_TIMEOUT_MS - 1;
    typeInto(doc, id, 'b');
    undo.boundary();

    expect(undo.undo()).toBe(true);
    expect(getStickyText(doc, id)!.toString()).toBe(''); // merged burst
    undo.destroy();
  });

  test('boundary on an empty stack is a no-op', () => {
    const doc = newDoc();
    const undo = createUndo(doc);
    expect(() => undo.boundary()).not.toThrow();
    expect(undo.canUndo()).toBe(false);
    expect(undo.undo()).toBe(false);
    typeInto(doc, createSticky(doc, { x: 0, y: 0 }), 'a');
    expect(undo.canUndo()).toBe(true);
    undo.destroy();
  });
});
